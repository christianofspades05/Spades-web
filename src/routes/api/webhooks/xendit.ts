/**
 * Xendit invoice webhook. Verifies the x-callback-token header against
 * XENDIT_WEBHOOK_VERIFICATION_TOKEN before trusting anything in the body —
 * without that check, anyone who found this URL could POST a fake "PAID"
 * event and get an order marked paid for free.
 *
 * `payload.external_id` is a `checkout_reservations.id` (see
 * server/checkout/place-order.ts — online-payment checkouts never create an
 * `orders` row up front). PAID mints the real order right here (via
 * server/checkout/mint-order.ts, shared with PayPal's own confirmation
 * paths). EXPIRED/FAILED re-checks the invoice's live status with Xendit
 * before touching anything — confirmed live twice that Xendit can send an
 * EXPIRED webhook for an invoice that was actually paid moments earlier
 * (its own internal PAID confirmation lagging the payment by several
 * minutes), which would otherwise delete a paid order's reservation out
 * from under it. Only once live status confirms it's truly unpaid does this
 * release the reservation's stock and delete it — nothing ever touches
 * `orders` for a genuinely abandoned/failed payment.
 *
 * Idempotent by design: webhook_events is upserted on (source,
 * external_event_id, event_type) — event_type is part of the key so a
 * later lifecycle event (e.g. PAID) never overwrites an earlier one's row
 * (e.g. EXPIRED), preserving the full event history for debugging exactly
 * this kind of race. Since a reservation is deleted once resolved, a
 * retried event either still finds the reservation (safe to reprocess from
 * scratch) or finds the order it already produced via
 * `orders.external_order_id` and no-ops.
 */
import { createFileRoute } from '@tanstack/react-router'
import type { CheckoutReservationItem, PaymentProvider } from '#/types/database.types'

// Dynamic imports (not top-level) are deliberate: routeTree.gen.ts imports
// every route file — including this one — eagerly so the client can build
// its route tree, and unlike createServerFn, a `server.handlers` route like
// this one doesn't get its server-only code split out of the client bundle
// automatically. A top-level import of admin.ts or xendit/client.ts would
// therefore run their browser guards in every visitor's browser. Importing
// them only inside the handler means that code never loads unless this
// handler actually executes, which only happens server-side.

interface XenditInvoiceWebhookPayload {
  id: string
  external_id: string
  status: string
  payment_channel?: string
  payment_method?: string
  currency?: string
  amount?: number
  [key: string]: unknown
}

function mapPaymentProvider(
  payload: XenditInvoiceWebhookPayload,
): PaymentProvider {
  const channel = (payload.payment_channel ?? '').toUpperCase()
  const method = (payload.payment_method ?? '').toUpperCase()
  if (channel.includes('GCASH')) return 'gcash'
  if (channel.includes('MAYA') || channel.includes('PAYMAYA')) return 'paymaya'
  if (method.includes('CARD') || channel.includes('CARD')) return 'card'
  if (method.includes('BANK') || method.includes('VIRTUAL_ACCOUNT'))
    return 'bank_transfer'
  return 'other'
}

export const Route = createFileRoute('/api/webhooks/xendit')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isValidXenditWebhookToken, getXenditInvoice } =
          await import('#/lib/xendit/client')
        const { getSupabaseAdminClient } = await import('#/lib/supabase/admin')

        const callbackToken = request.headers.get('x-callback-token')
        if (!isValidXenditWebhookToken(callbackToken)) {
          return new Response('Invalid callback token', { status: 401 })
        }

        const payload = (await request.json()) as XenditInvoiceWebhookPayload
        const admin = getSupabaseAdminClient()

        // Upsert, not insert — Xendit may retry the same event if we didn't
        // respond 200 in time, and (source, external_event_id, event_type)
        // is unique. event_type is part of the key (not just source +
        // external_event_id) because external_event_id is the invoice's own
        // id, which stays the same across that invoice's whole lifecycle —
        // without event_type in the key, a later event (e.g. PAID) would
        // silently overwrite an earlier one's row (e.g. EXPIRED) on upsert,
        // erasing the evidence a status-race ever happened.
        await admin.from('webhook_events').upsert(
          {
            source: 'payment_provider',
            event_type: payload.status,
            external_event_id: payload.id,
            payload,
            status: 'processing',
          },
          { onConflict: 'source,external_event_id,event_type' },
        )

        try {
          // Resolve external_id against `orders` first — if a real order
          // already exists for it, this event (or an earlier PAID for the
          // same reservation) was already fully processed; no-op.
          const { data: existingOrder, error: existingOrderError } = await admin
            .from('orders')
            .select('id')
            .eq('source', 'storefront')
            .eq('external_order_id', payload.external_id)
            .maybeSingle()
          if (existingOrderError) throw existingOrderError

          if (!existingOrder) {
            const { data: reservation, error: reservationError } = await admin
              .from('checkout_reservations')
              .select('*')
              .eq('id', payload.external_id)
              .maybeSingle()
            if (reservationError) throw reservationError
            if (!reservation) {
              throw new Error(
                `No order or reservation found for external_id ${payload.external_id}`,
              )
            }

            const items = reservation.items

            if (payload.status === 'PAID') {
              const { majorUnitsToCents } = await import('#/lib/utils/money')
              const { mintOrderFromReservation } = await import(
                '#/server/checkout/mint-order'
              )

              // Xendit's payload is the authoritative record of what was
              // actually charged — overwrite our upfront (request-time)
              // estimate with it whenever present, in case the confirmed
              // amount ever differs (e.g. an FX rate that moved between
              // invoice creation and payment).
              const chargedCurrency =
                payload.currency && payload.currency !== 'PHP'
                  ? payload.currency
                  : null
              await mintOrderFromReservation(admin, reservation, {
                provider: mapPaymentProvider(payload),
                providerReference: payload.id,
                chargedCurrency,
                chargedAmountCents:
                  chargedCurrency && typeof payload.amount === 'number'
                    ? majorUnitsToCents(payload.amount, chargedCurrency)
                    : null,
              })
            } else if (
              payload.status === 'EXPIRED' ||
              payload.status === 'FAILED'
            ) {
              // Before releasing anything, re-check the invoice's CURRENT
              // status directly with Xendit rather than trusting this
              // webhook's own (possibly stale) status. Confirmed live twice:
              // a customer paid within seconds of invoice creation, but
              // Xendit's own invoice record didn't reflect PAID for ~5 more
              // minutes (its own `updated` timestamp lagged `paid_at` by
              // that much) — long enough for an EXPIRED sweep to fire for
              // an invoice that was actually already paid, deleting the
              // reservation before the (correct, but delayed) PAID webhook
              // ever arrived to find it. Re-fetching here closes that race
              // regardless of which side of Xendit's pipeline is slow.
              const liveInvoice = await getXenditInvoice(payload.id)

              // SETTLED, not just PAID — confirmed live that by the time
              // this re-check runs, Xendit's own invoice can have already
              // progressed past PAID into SETTLED (funds cleared to the
              // merchant), so checking for PAID alone would still miss it.
              if (
                liveInvoice.status === 'PAID' ||
                liveInvoice.status === 'SETTLED'
              ) {
                const { majorUnitsToCents } = await import('#/lib/utils/money')
                const { mintOrderFromReservation } = await import(
                  '#/server/checkout/mint-order'
                )
                const chargedCurrency =
                  liveInvoice.currency && liveInvoice.currency !== 'PHP'
                    ? liveInvoice.currency
                    : null
                await mintOrderFromReservation(admin, reservation, {
                  provider: mapPaymentProvider(payload),
                  providerReference: liveInvoice.id,
                  chargedCurrency,
                  chargedAmountCents: chargedCurrency
                    ? majorUnitsToCents(liveInvoice.amount, chargedCurrency)
                    : null,
                })
              } else {
                // Genuinely abandoned (EXPIRED, never paid) or rejected
                // (FAILED) — nothing was ever created in `orders`, so
                // there's nothing to cancel, just give the stock back.
                await Promise.all(
                  items
                    .filter(
                      (
                        item,
                      ): item is CheckoutReservationItem & {
                        variantId: string
                      } => item.variantId !== null,
                    )
                    .map((item) =>
                      admin.rpc('release_variant_stock', {
                        p_variant_id: item.variantId,
                        p_quantity: item.quantity,
                      }),
                    ),
                )
                await admin
                  .from('checkout_reservations')
                  .delete()
                  .eq('id', reservation.id)
              }
            }
          }

          await admin
            .from('webhook_events')
            .update({
              status: 'processed',
              processed_at: new Date().toISOString(),
            })
            .eq('source', 'payment_provider')
            .eq('external_event_id', payload.id)
            .eq('event_type', payload.status)
        } catch (err) {
          await admin
            .from('webhook_events')
            .update({
              status: 'failed',
              error_message: err instanceof Error ? err.message : String(err),
            })
            .eq('source', 'payment_provider')
            .eq('external_event_id', payload.id)
            .eq('event_type', payload.status)
          throw err
        }

        return Response.json({ received: true })
      },
    },
  },
})

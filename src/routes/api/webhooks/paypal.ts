/**
 * PayPal webhook — a safety net, not the primary confirmation path (that's
 * checkout/paypal-return.tsx's synchronous capture-on-return). This exists
 * to still confirm a payment if the customer's browser never makes it back
 * to our return URL (closed tab, network drop, etc. after approving).
 *
 * Verifies every event via PayPal's own /v1/notifications/verify-webhook-
 * signature endpoint before trusting anything in the body — PayPal signs
 * webhooks with a certificate rather than a shared static token (unlike
 * Xendit's x-callback-token), so verification is itself an API call, not a
 * simple string comparison.
 *
 * Idempotent the same way the Xendit webhook is: mint-order.ts's caller
 * here checks `orders.external_order_id` first, so a webhook that arrives
 * after (or racing) the return route's own capture just no-ops.
 */
import { createFileRoute } from '@tanstack/react-router'

// Dynamic imports (not top-level) are deliberate — same reasoning as
// api/webhooks/xendit.ts: routeTree.gen.ts eagerly imports every route
// file for the client route tree, and a server.handlers route (unlike
// createServerFn) doesn't get server-only code split out of the client
// bundle automatically.

interface PayPalWebhookEvent {
  id: string
  event_type: string
  resource: {
    id: string
    status?: string
    amount?: { currency_code: string; value: string }
    supplementary_data?: { related_ids?: { order_id?: string } }
    payer?: { email_address?: string }
    [key: string]: unknown
  }
  [key: string]: unknown
}

export const Route = createFileRoute('/api/webhooks/paypal')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyPayPalWebhookSignature, capturePayPalOrder } =
          await import('#/lib/paypal/client')
        const { getSupabaseAdminClient } = await import('#/lib/supabase/admin')

        const rawBody = await request.text()
        const event = JSON.parse(rawBody) as PayPalWebhookEvent

        const verified = await verifyPayPalWebhookSignature(
          {
            transmissionId: request.headers.get('paypal-transmission-id'),
            transmissionTime: request.headers.get('paypal-transmission-time'),
            transmissionSig: request.headers.get('paypal-transmission-sig'),
            certUrl: request.headers.get('paypal-cert-url'),
            authAlgo: request.headers.get('paypal-auth-algo'),
          },
          event,
        )
        if (!verified) {
          return new Response('Invalid webhook signature', { status: 401 })
        }

        const admin = getSupabaseAdminClient()

        // Upsert, not insert — PayPal may retry the same event if we
        // didn't respond 200 in time, and (source, external_event_id) is
        // unique. Reuses the same 'payment_provider' source Xendit's
        // webhook events already use — both are payment-provider
        // webhooks, and nothing downstream branches on which one.
        await admin.from('webhook_events').upsert(
          {
            source: 'payment_provider',
            event_type: event.event_type,
            external_event_id: event.id,
            payload: event,
            status: 'processing',
          },
          { onConflict: 'source,external_event_id' },
        )

        try {
          if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
            const paypalOrderId = event.resource.supplementary_data
              ?.related_ids?.order_id
            if (!paypalOrderId) {
              throw new Error(
                `PAYMENT.CAPTURE.COMPLETED event ${event.id} had no related PayPal order id.`,
              )
            }

            const { data: reservation, error: reservationError } = await admin
              .from('checkout_reservations')
              .select('*')
              .eq('paypal_order_id', paypalOrderId)
              .maybeSingle()
            if (reservationError) throw reservationError

            // Already minted (almost always via the return route beating
            // this webhook here) or the reservation was already cleaned
            // up some other way — either way, nothing left to do.
            if (reservation) {
              const { majorUnitsToCents } = await import('#/lib/utils/money')
              const { mintOrderFromReservation } = await import(
                '#/server/checkout/mint-order'
              )
              // capturePayPalOrder is safe to call again here even though
              // the payment is already captured — used only to fetch the
              // capture's own id/amount in a shape mintOrderFromReservation
              // expects; PayPal itself no-ops re-capturing an already-
              // captured order rather than charging twice.
              const capture = await capturePayPalOrder(paypalOrderId)
              const chargedCurrency =
                capture.currencyCode !== 'PHP' ? capture.currencyCode : null
              await mintOrderFromReservation(admin, reservation, {
                provider: 'paypal',
                providerReference: capture.captureId,
                chargedCurrency,
                chargedAmountCents: chargedCurrency
                  ? majorUnitsToCents(Number(capture.amount), chargedCurrency)
                  : null,
              })
            }
          } else if (event.event_type === 'PAYMENT.CAPTURE.DENIED') {
            const paypalOrderId = event.resource.supplementary_data
              ?.related_ids?.order_id
            if (paypalOrderId) {
              const { data: reservation } = await admin
                .from('checkout_reservations')
                .select('*')
                .eq('paypal_order_id', paypalOrderId)
                .maybeSingle()
              if (reservation) {
                await Promise.all(
                  reservation.items
                    .filter(
                      (
                        item,
                      ): item is (typeof reservation.items)[number] & {
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
            .eq('external_event_id', event.id)
        } catch (err) {
          await admin
            .from('webhook_events')
            .update({
              status: 'failed',
              error_message: err instanceof Error ? err.message : String(err),
            })
            .eq('source', 'payment_provider')
            .eq('external_event_id', event.id)
          throw err
        }

        return Response.json({ received: true })
      },
    },
  },
})

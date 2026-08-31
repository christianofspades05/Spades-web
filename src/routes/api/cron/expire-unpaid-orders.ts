/**
 * Backstop for online (Xendit) checkouts that were started but never paid —
 * see place-order.ts: a `checkout_reservations` row is created and stock
 * reserved *before* the customer finishes paying, specifically so two
 * shoppers can't both be sold the last unit while one of them is still on
 * Xendit's payment page. No `orders` row exists for these until PAID. The
 * primary mechanism is Xendit's own invoice expiry (5 min, place-order.ts)
 * pushing an EXPIRED webhook event (xendit.ts) that releases the stock and
 * deletes the reservation almost immediately. This cron only matters if
 * that webhook never arrives — without it, an abandoned reservation would
 * hold its stock forever. Before releasing anything, it re-checks each
 * stale reservation's invoice status live with Xendit (same reasoning as
 * xendit.ts's own EXPIRED/FAILED branch) — a reservation can in principle
 * have actually been paid with its PAID webhook still delayed or lost by
 * the time this cron reaches it.
 *
 * COD orders never go through `checkout_reservations` at all — they're a
 * real, confirmed order the moment they're placed — so this cron has
 * nothing to do with them.
 *
 * Trigger via an external scheduler (cron-job.org, every 15 min) sending
 * `Authorization: Bearer $CRON_SECRET` — NOT added to vercel.json's cron
 * list, which is already at this Vercel plan's 2-daily-cron cap
 * (review-requests, sync-channels-daily), same reasoning as
 * api/cron/abandoned-cart.ts. Kept at this same route path (rather than
 * renamed to match what it now sweeps) so that external schedule doesn't
 * need reconfiguring.
 */
import { createFileRoute } from '@tanstack/react-router'

// Comfortably longer than the 5-minute invoice life + webhook delivery
// time, so this doesn't race the webhook — but short enough to not leave
// stock reserved for a full hour if the webhook genuinely never arrives.
const EXPIRE_AFTER_MINUTES = 15

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('CRON_SECRET is not set — rejecting all cron requests.')
    return false
  }
  return request.headers.get('authorization') === `Bearer ${expected}`
}

export const Route = createFileRoute('/api/cron/expire-unpaid-orders')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthorized(request)) {
          return new Response('Unauthorized', { status: 401 })
        }

        const { getSupabaseAdminClient } = await import('#/lib/supabase/admin')
        const { getXenditInvoice } = await import('#/lib/xendit/client')
        const admin = getSupabaseAdminClient()

        const cutoff = new Date(
          Date.now() - EXPIRE_AFTER_MINUTES * 60_000,
        ).toISOString()

        const { data: staleReservations, error: staleError } = await admin
          .from('checkout_reservations')
          .select('*')
          .lt('created_at', cutoff)
        if (staleError) throw staleError

        const expired: string[] = []
        const minted: string[] = []
        const failures: { reservationId: string; error: string }[] = []

        for (const reservation of staleReservations) {
          try {
            const items = reservation.items

            // Same live re-check as the Xendit webhook's own EXPIRED/FAILED
            // branch (see api/webhooks/xendit.ts) — this reservation could
            // in principle have actually been paid moments before this cron
            // ran, with the PAID webhook itself still delayed or lost.
            // Trust Xendit's current status, not just "this is old", before
            // releasing stock out from under a real sale.
            let livePaid = false
            if (reservation.xendit_invoice_id) {
              const liveInvoice = await getXenditInvoice(
                reservation.xendit_invoice_id,
              )
              // SETTLED, not just PAID — see xendit.ts's own version of
              // this same check for why.
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
                  provider: 'other',
                  providerReference: liveInvoice.id,
                  chargedCurrency,
                  chargedAmountCents: chargedCurrency
                    ? majorUnitsToCents(liveInvoice.amount, chargedCurrency)
                    : null,
                })
                minted.push(reservation.id)
                livePaid = true
              }
            }

            if (!livePaid) {
              for (const item of items) {
                if (!item.variantId) continue
                const { error: releaseError } = await admin.rpc(
                  'release_variant_stock',
                  { p_variant_id: item.variantId, p_quantity: item.quantity },
                )
                if (releaseError) throw releaseError
              }

              const { error: deleteError } = await admin
                .from('checkout_reservations')
                .delete()
                .eq('id', reservation.id)
              if (deleteError) throw deleteError

              expired.push(reservation.id)
            }
          } catch (err) {
            failures.push({
              reservationId: reservation.id,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        return Response.json({
          scanned: staleReservations.length,
          expired,
          minted,
          failures,
        })
      },
    },
  },
})

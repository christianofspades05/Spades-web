/**
 * Auto-cancels online (Xendit) orders that were placed but never paid —
 * see place-order.ts: an order is created with status='pending_payment'
 * and stock reserved *before* the customer finishes paying, specifically so
 * two shoppers can't both be sold the last unit while one of them is still
 * on Xendit's payment page. If that customer just abandons the page, the
 * order would otherwise sit as 'pending_payment' forever, which is
 * confusing for fulfillment (looks like a real order) and inflates the
 * admin dashboard's Orders count.
 *
 * Only ever touches is_cod=false orders — COD orders are *supposed* to
 * stay 'pending_payment' until delivery, that's not an abandoned payment.
 *
 * Trigger via an external scheduler (cron-job.org, every 15-30 min)
 * sending `Authorization: Bearer $CRON_SECRET` — NOT added to
 * vercel.json's cron list, which is already at this Vercel plan's
 * 2-daily-cron cap (review-requests, sync-channels-daily), same reasoning
 * as api/cron/abandoned-cart.ts.
 */
import { createFileRoute } from '@tanstack/react-router'

const EXPIRE_AFTER_MINUTES = 60

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
        const admin = getSupabaseAdminClient()

        const cutoff = new Date(
          Date.now() - EXPIRE_AFTER_MINUTES * 60_000,
        ).toISOString()

        const { data: staleOrders, error: staleError } = await admin
          .from('orders')
          .select('id, order_number')
          .eq('status', 'pending_payment')
          .eq('is_cod', false)
          .lt('placed_at', cutoff)
        if (staleError) throw staleError

        const cancelled: string[] = []
        const failures: { orderId: string; error: string }[] = []

        for (const order of staleOrders) {
          try {
            const { data: items, error: itemsError } = await admin
              .from('order_items')
              .select('variant_id, quantity')
              .eq('order_id', order.id)
            if (itemsError) throw itemsError

            for (const item of items) {
              if (!item.variant_id) continue
              const { error: releaseError } = await admin.rpc(
                'release_variant_stock',
                { p_variant_id: item.variant_id, p_quantity: item.quantity },
              )
              if (releaseError) throw releaseError
            }

            const { error: orderUpdateError } = await admin
              .from('orders')
              .update({
                status: 'cancelled',
                cancelled_at: new Date().toISOString(),
                cancellation_reason: 'payment_expired',
              })
              .eq('id', order.id)
            if (orderUpdateError) throw orderUpdateError

            await admin
              .from('payments')
              .update({ status: 'failed' })
              .eq('order_id', order.id)
              .eq('status', 'pending')

            cancelled.push(order.order_number)
          } catch (err) {
            failures.push({
              orderId: order.id,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        return Response.json({
          scanned: staleOrders.length,
          cancelled,
          failures,
        })
      },
    },
  },
})

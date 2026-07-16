/**
 * Xendit invoice webhook. Verifies the x-callback-token header against
 * XENDIT_WEBHOOK_VERIFICATION_TOKEN before trusting anything in the body —
 * without that check, anyone who found this URL could POST a fake "PAID"
 * event and get an order marked paid for free.
 *
 * Idempotent by design: webhook_events is upserted on (source,
 * external_event_id), and the order/payment/stock updates are skipped if
 * the order is already in its target state — safe against Xendit retries.
 */
import { createFileRoute } from '@tanstack/react-router'
import type { PaymentProvider } from '#/types/database.types'

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
        const { isValidXenditWebhookToken } =
          await import('#/lib/xendit/client')
        const { getSupabaseAdminClient } = await import('#/lib/supabase/admin')

        const callbackToken = request.headers.get('x-callback-token')
        if (!isValidXenditWebhookToken(callbackToken)) {
          return new Response('Invalid callback token', { status: 401 })
        }

        const payload = (await request.json()) as XenditInvoiceWebhookPayload
        const admin = getSupabaseAdminClient()

        // Upsert, not insert — Xendit may retry the same event if we didn't
        // respond 200 in time, and (source, external_event_id) is unique.
        await admin.from('webhook_events').upsert(
          {
            source: 'payment_provider',
            event_type: payload.status,
            external_event_id: payload.id,
            payload,
            status: 'processing',
          },
          { onConflict: 'source,external_event_id' },
        )

        try {
          const { data: order, error: orderError } = await admin
            .from('orders')
            .select('id, status')
            .eq('order_number', payload.external_id)
            .maybeSingle()
          if (orderError) throw orderError
          if (!order) {
            throw new Error(
              `No order found for external_id ${payload.external_id}`,
            )
          }

          const { data: payment, error: paymentError } = await admin
            .from('payments')
            .select('id, status')
            .eq('order_id', order.id)
            .maybeSingle()
          if (paymentError) throw paymentError

          const { data: orderItems, error: itemsError } = await admin
            .from('order_items')
            .select('variant_id, quantity')
            .eq('order_id', order.id)
          if (itemsError) throw itemsError

          if (payload.status === 'PAID' && order.status !== 'paid') {
            for (const item of orderItems) {
              if (!item.variant_id) continue
              await admin.rpc('commit_variant_stock', {
                p_variant_id: item.variant_id,
                p_quantity: item.quantity,
              })
            }

            await admin
              .from('orders')
              .update({ status: 'paid' })
              .eq('id', order.id)
            if (payment) {
              await admin
                .from('payments')
                .update({
                  status: 'captured',
                  provider: mapPaymentProvider(payload),
                  provider_reference: payload.id,
                  captured_at: new Date().toISOString(),
                })
                .eq('id', payment.id)
            }
          } else if (
            (payload.status === 'EXPIRED' || payload.status === 'FAILED') &&
            order.status === 'pending_payment'
          ) {
            for (const item of orderItems) {
              if (!item.variant_id) continue
              await admin.rpc('release_variant_stock', {
                p_variant_id: item.variant_id,
                p_quantity: item.quantity,
              })
            }

            await admin
              .from('orders')
              .update({ status: 'failed' })
              .eq('id', order.id)
            if (payment) {
              await admin
                .from('payments')
                .update({ status: 'failed' })
                .eq('id', payment.id)
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
        } catch (err) {
          await admin
            .from('webhook_events')
            .update({
              status: 'failed',
              error_message: err instanceof Error ? err.message : String(err),
            })
            .eq('source', 'payment_provider')
            .eq('external_event_id', payload.id)
          throw err
        }

        return Response.json({ received: true })
      },
    },
  },
})

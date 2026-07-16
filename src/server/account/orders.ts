import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireCustomer } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'

const FULFILLED_SHIPMENT_STATUSES = new Set([
  'packed',
  'in_transit',
  'out_for_delivery',
  'delivered',
])
const TERMINAL_ORDER_STATUSES = new Set([
  'cancelled',
  'refunded',
  'failed',
  'delivered',
])

/**
 * Customer-initiated cancellation — deliberately narrower than the admin
 * cancel flow (src/server/admin/orders.ts): only Cash on Delivery orders,
 * and only before fulfillment. Online-paid orders need a real refund
 * decision, which stays a staff-only action.
 *
 * COD orders only ever have their stock *reserved* at checkout — nothing
 * commits it (commit_variant_stock only runs from the Xendit webhook, for
 * online payments) — so release_variant_stock is always the correct
 * reversal here, unlike the admin flow which also has to handle stock
 * that was already committed.
 */
export const cancelMyOrder = createServerFn({ method: 'POST' })
  .validator(z.object({ orderId: z.string().uuid() }))
  .handler(async ({ data }): Promise<void> => {
    const customer = await requireCustomer()
    const admin = getSupabaseAdminClient()

    const { data: order, error } = await admin
      .from('orders')
      .select('id, customer_id, status, is_cod')
      .eq('id', data.orderId)
      .maybeSingle()
    if (error) throw error
    if (!order || order.customer_id !== customer.id) {
      throw new Error('Order not found.')
    }
    if (!order.is_cod) {
      throw new Error(
        'Only Cash on Delivery orders can be cancelled here — contact support for other orders.',
      )
    }
    if (TERMINAL_ORDER_STATUSES.has(order.status)) {
      throw new Error('This order can no longer be cancelled.')
    }

    const { data: shipments, error: shipmentsError } = await admin
      .from('shipments')
      .select('status')
      .eq('order_id', order.id)
    if (shipmentsError) throw shipmentsError
    if (shipments.some((s) => FULFILLED_SHIPMENT_STATUSES.has(s.status))) {
      throw new Error(
        'This order has already been fulfilled and can no longer be cancelled.',
      )
    }

    const { data: items, error: itemsError } = await admin
      .from('order_items')
      .select('variant_id, quantity')
      .eq('order_id', order.id)
    if (itemsError) throw itemsError

    for (const item of items) {
      if (!item.variant_id) continue
      await admin.rpc('release_variant_stock', {
        p_variant_id: item.variant_id,
        p_quantity: item.quantity,
        p_reference_type: 'customer_cancel',
        p_reference_id: order.id,
      })
    }

    const { error: updateError } = await admin
      .from('orders')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', order.id)
    if (updateError) throw updateError
  })

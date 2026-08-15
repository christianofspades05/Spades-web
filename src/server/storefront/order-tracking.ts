/**
 * Public, no-login order tracking — the "View order" link in the order
 * confirmation email (src/lib/email/templates/order-confirmation.ts) used
 * to point at /account, which requires a real password login. Most COD
 * customers check out as guests and never set one, so that link was
 * effectively broken for them (a login wall, not a tracking page).
 *
 * Authorization here is "you know the order id" — the same trust model
 * src/server/reviews/public.ts already uses for its review_token, except
 * this reuses the order's own UUID directly rather than minting a separate
 * token: unlike a review link (one-time, expires), a tracking link should
 * stay valid indefinitely so the customer can check back as status
 * changes, which is exactly what a permanent identifier is for.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
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

export interface TrackedOrderItem {
  id: string
  name: string
  variantLabel: string | null
  quantity: number
  imageUrl: string | null
}

export interface TrackedOrder {
  orderNumber: string
  status: string
  placedAt: string
  totalCents: number
  currency: string
  items: TrackedOrderItem[]
  isFulfilled: boolean
  trackingNumber: string | null
  trackingUrl: string | null
  carrier: string | null
  canCancel: boolean
  cancelledAt: string | null
  cancellationDetail: string | null
}

export const getOrderForTracking = createServerFn({ method: 'GET' })
  .validator(z.object({ orderId: z.string().uuid() }))
  .handler(async ({ data }): Promise<TrackedOrder | null> => {
    const admin = getSupabaseAdminClient()

    const { data: order, error } = await admin
      .from('orders')
      .select(
        'order_number, status, placed_at, total_cents, currency, is_cod, cancelled_at, cancellation_detail, order_items(id, product_name_snapshot, variant_label_snapshot, quantity, variant_id)',
      )
      .eq('id', data.orderId)
      .maybeSingle()
    if (error) throw error
    if (!order) return null

    const { data: shipments, error: shipmentsError } = await admin
      .from('shipments')
      .select('status, tracking_number, tracking_url, carrier')
      .eq('order_id', data.orderId)
    if (shipmentsError) throw shipmentsError
    const shipment = shipments.at(0) ?? null
    const isFulfilled = shipments.some((s) =>
      FULFILLED_SHIPMENT_STATUSES.has(s.status),
    )

    const variantIds = order.order_items
      .map((item) => item.variant_id)
      .filter((id): id is string => id !== null)
    const imageByVariantId = new Map<string, string | null>()
    if (variantIds.length > 0) {
      const { data: variants, error: variantsError } = await admin
        .from('product_variants')
        .select('id, product:products(images)')
        .in('id', variantIds)
      if (variantsError) throw variantsError
      for (const variant of variants) {
        imageByVariantId.set(variant.id, variant.product.images[0] ?? null)
      }
    }

    const canCancel =
      order.is_cod &&
      !TERMINAL_ORDER_STATUSES.has(order.status) &&
      !isFulfilled

    return {
      orderNumber: order.order_number,
      status: order.status,
      placedAt: order.placed_at,
      totalCents: order.total_cents,
      currency: order.currency,
      items: order.order_items.map((item) => ({
        id: item.id,
        name: item.product_name_snapshot,
        variantLabel: item.variant_label_snapshot,
        quantity: item.quantity,
        imageUrl: item.variant_id
          ? (imageByVariantId.get(item.variant_id) ?? null)
          : null,
      })),
      isFulfilled,
      trackingNumber: shipment?.tracking_number ?? null,
      trackingUrl: shipment?.tracking_url ?? null,
      carrier: shipment?.carrier ?? null,
      canCancel,
      cancelledAt: order.cancelled_at,
      cancellationDetail: order.cancellation_detail,
    }
  })

/**
 * Guest-safe cancellation — same rules as src/server/account/orders.ts's
 * cancelMyOrder (COD-only, pre-fulfillment only), minus the customer_id
 * identity check: this page's whole security model is "you have the link,"
 * same as the read above, so there's no separate identity to check against.
 */
export const cancelTrackedOrder = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      orderId: z.string().uuid(),
      reason: z
        .string()
        .trim()
        .min(1, 'Please tell us why you want to cancel this order.')
        .max(500),
    }),
  )
  .handler(async ({ data }): Promise<void> => {
    const admin = getSupabaseAdminClient()

    const { data: order, error } = await admin
      .from('orders')
      .select('id, status, is_cod')
      .eq('id', data.orderId)
      .maybeSingle()
    if (error) throw error
    if (!order) throw new Error('Order not found.')
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

    const itemsWithVariant = items.filter(
      (item): item is { variant_id: string; quantity: number } =>
        item.variant_id !== null,
    )
    await Promise.all(
      itemsWithVariant.map((item) =>
        admin.rpc('release_variant_stock', {
          p_variant_id: item.variant_id,
          p_quantity: item.quantity,
          p_reference_type: 'customer_cancel',
          p_reference_id: order.id,
        }),
      ),
    )

    const { error: updateError } = await admin
      .from('orders')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: 'customer_request',
        cancellation_detail: data.reason,
      })
      .eq('id', order.id)
    if (updateError) throw updateError
  })

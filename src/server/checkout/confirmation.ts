/**
 * Public lookup for the checkout confirmation ("thank you") page — reached
 * right after a guest or logged-in checkout, before any session necessarily
 * exists (place-order.ts supports guest carts). The order number in the URL
 * (the same value Xendit's success redirect and the COD path already pass)
 * is the only "credential" this page has, same as most storefronts' own
 * thank-you pages — so this intentionally returns only what's already safe
 * to show there: item names/quantities/images and the order's cents
 * breakdown. No customer, address, or payment info.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'

/** Mirrors the same helper in src/server/admin/orders.ts and src/server/account/queries.ts. */
async function getProductImagesByVariantId(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  variantIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  if (variantIds.length === 0) return map

  const { data, error } = await admin
    .from('product_variants')
    .select('id, product:products(images)')
    .in('id', variantIds)
  if (error) throw error

  for (const row of data) {
    map.set(row.id, row.product.images[0] ?? null)
  }
  return map
}

export interface ConfirmationOrderItem {
  id: string
  productName: string
  variantLabel: string | null
  quantity: number
  imageUrl: string | null
}

export interface OrderConfirmation {
  items: ConfirmationOrderItem[]
  subtotalCents: number
  discountCents: number
  shippingCents: number
  totalCents: number
}

export const getOrderConfirmation = createServerFn({ method: 'GET' })
  .validator(z.object({ orderNumber: z.string().min(1) }))
  .handler(async ({ data }): Promise<OrderConfirmation | null> => {
    const admin = getSupabaseAdminClient()
    const { data: order, error } = await admin
      .from('orders')
      .select(
        'id, subtotal_cents, discount_cents, shipping_cents, total_cents, order_items(id, product_name_snapshot, variant_label_snapshot, quantity, variant_id)',
      )
      .eq('order_number', data.orderNumber)
      .maybeSingle()
    if (error) throw error
    if (!order) return null

    const variantIds = Array.from(
      new Set(
        order.order_items
          .map((i) => i.variant_id)
          .filter((v): v is string => !!v),
      ),
    )
    const imageMap = await getProductImagesByVariantId(admin, variantIds)

    return {
      items: order.order_items.map((item) => ({
        id: item.id,
        productName: item.product_name_snapshot,
        variantLabel: item.variant_label_snapshot,
        quantity: item.quantity,
        imageUrl: item.variant_id
          ? (imageMap.get(item.variant_id) ?? null)
          : null,
      })),
      subtotalCents: order.subtotal_cents,
      discountCents: order.discount_cents,
      shippingCents: order.shipping_cents,
      totalCents: order.total_cents,
    }
  })

export type ReservationConfirmationResult =
  | { status: 'paid'; orderNumber: string; confirmation: OrderConfirmation }
  | { status: 'pending' }

/**
 * Polled by the confirmation page for an online-payment checkout, whose
 * Xendit success redirect only ever carries a `checkout_reservations` id
 * (no order exists yet at that point — see place-order.ts). The webhook
 * that mints the real order (xendit.ts) runs async, server-to-server, and
 * isn't guaranteed to land before the customer's browser gets redirected
 * back here — so this can legitimately report 'pending' for a second or
 * two after a successful payment. Once the order is minted, its
 * `external_order_id` is set to the reservation id, which is how this
 * finds it.
 */
export const getOrderConfirmationByReservation = createServerFn({
  method: 'GET',
})
  .validator(z.object({ reservationId: z.string().min(1) }))
  .handler(async ({ data }): Promise<ReservationConfirmationResult> => {
    const admin = getSupabaseAdminClient()
    const { data: order, error } = await admin
      .from('orders')
      .select('order_number')
      .eq('source', 'storefront')
      .eq('external_order_id', data.reservationId)
      .maybeSingle()
    if (error) throw error
    if (!order) return { status: 'pending' }

    const confirmation = await getOrderConfirmation({
      data: { orderNumber: order.order_number },
    })
    if (!confirmation) return { status: 'pending' }

    return { status: 'paid', orderNumber: order.order_number, confirmation }
  })

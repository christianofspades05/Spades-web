import type { OrderSource, OrderStatus, Payment } from '#/types/entities'

/**
 * Whether staff can add/remove/swap an order's line items. Shared between
 * the order detail page (to hide the "Edit items" button) and
 * updateOrderItems (re-checked server-side as defense in depth, since the
 * client can't be trusted and the order's state may have changed in the
 * seconds since the page loaded) — see src/server/admin/orders.ts.
 *
 * Marketplace orders (TikTok Shop/Shopee/Lazada) are synced one-way; there's
 * no mechanism to push an edited item list back, so editing them locally
 * would silently diverge from the marketplace's own record on its next sync.
 * A captured online (Xendit) payment means money has already changed hands
 * with no mechanism yet to adjust it. A shipment record means the physical
 * parcel is already being prepped.
 */
export const EDITABLE_ORDER_SOURCES = new Set<OrderSource>([
  'storefront',
  'admin',
])
export const EDITABLE_ORDER_STATUSES = new Set<OrderStatus>([
  'pending_payment',
  'paid',
  'processing',
])

export function isOrderItemsEditable(order: {
  source: OrderSource
  status: OrderStatus
  payments: Pick<Payment, 'status'>[]
  shipments: unknown[]
}): boolean {
  if (!EDITABLE_ORDER_SOURCES.has(order.source)) return false
  if (!EDITABLE_ORDER_STATUSES.has(order.status)) return false
  if (order.shipments.length > 0) return false
  if (order.payments.some((p) => p.status === 'captured')) return false
  return true
}

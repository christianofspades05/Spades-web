import { z } from 'zod'

const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'processing',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
  'failed',
] as const

const SHIPMENT_STATUSES = [
  'pending',
  'packed',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'failed',
  'returned_to_sender',
] as const

const CANCELLATION_REASONS = [
  'failed_delivery',
  'customer_request',
  'out_of_stock',
] as const

export const orderStatusUpdateSchema = z.object({
  orderId: z.string().uuid(),
  status: z.enum(ORDER_STATUSES),
})

export const shipmentUpdateSchema = z.object({
  orderId: z.string().uuid(),
  carrier: z.string().trim().max(100).optional(),
  trackingNumber: z.string().trim().max(200).optional(),
  trackingUrl: z.string().trim().max(500).optional(),
  status: z.enum(SHIPMENT_STATUSES),
})

export const cancelOrderSchema = z.object({
  orderId: z.string().uuid(),
  restock: z.boolean(),
  reason: z.enum(CANCELLATION_REASONS),
})

export const bulkCancelOrdersSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1),
  restock: z.boolean(),
  reason: z.enum(CANCELLATION_REASONS),
})

const orderItemEditSchema = z.object({
  // Existing order_item row id, or null for a brand-new line being added.
  id: z.string().uuid().nullable(),
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(999),
})

// Client submits the entire desired final item list, not a diff — the
// server (updateOrderItems, src/server/admin/orders.ts) figures out what
// changed by comparing this against what's currently in the database. Any
// existing order_item id absent from this array is being removed.
export const updateOrderItemsSchema = z.object({
  orderId: z.string().uuid(),
  items: z
    .array(orderItemEditSchema)
    .min(1, 'An order must have at least one item'),
})

export type OrderStatusUpdateInput = z.infer<typeof orderStatusUpdateSchema>
export type ShipmentUpdateInput = z.infer<typeof shipmentUpdateSchema>
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>
export type BulkCancelOrdersInput = z.infer<typeof bulkCancelOrdersSchema>
export type OrderItemEditInput = z.infer<typeof orderItemEditSchema>
export type UpdateOrderItemsInput = z.infer<typeof updateOrderItemsSchema>

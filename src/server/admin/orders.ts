import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  bulkCancelOrdersSchema,
  cancelOrderSchema,
  orderStatusUpdateSchema,
  shipmentUpdateSchema,
} from '#/lib/validation/admin/orders'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { previousPeriod } from '#/lib/utils/date-range'
import { pushFulfillmentUpdate } from '#/server/integrations/marketplaces/sync-engine'
import { logStaffActivity } from './activity-log'
import type {
  Customer,
  Order,
  OrderItem,
  OrderStatus,
  Payment,
  Shipment,
} from '#/types/entities'

const MANAGE_ROLES = ['super_admin', 'admin', 'manager', 'packer'] as const

const FULFILLED_SHIPMENT_STATUSES = new Set([
  'packed',
  'in_transit',
  'out_for_delivery',
  'delivered',
])

/** Explicit allow-list so status can't be free-form updated — see src/server/orders/README.md. */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['paid', 'cancelled', 'failed'],
  paid: ['processing', 'refunded', 'cancelled'],
  processing: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
  failed: [],
}

interface OrderWithCustomer extends Order {
  customer: Pick<Customer, 'id' | 'email' | 'full_name'>
  order_items: (Pick<
    OrderItem,
    | 'id'
    | 'product_name_snapshot'
    | 'variant_label_snapshot'
    | 'quantity'
    | 'variant_id'
  > & { image_url: string | null })[]
  payments: Pick<Payment, 'status' | 'created_at'>[]
  shipments: Pick<Shipment, 'status' | 'carrier' | 'tracking_number'>[]
}
interface OrderWithDetails extends Order {
  customer: Customer
  order_items: (OrderItem & { image_url: string | null })[]
  payments: Payment[]
  shipments: Shipment[]
}

/**
 * order_items only stores product/variant name snapshots, not an image —
 * this looks the current product image up via product_variants (which,
 * unlike orders/order_items, has a real Relationships entry in
 * database.types.ts, so the embedded select type-checks cleanly).
 */
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

export const listOrders = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      status: z.string().optional(),
      source: z.string().optional(),
      fulfillment: z.enum(['fulfilled', 'unfulfilled']).optional(),
      q: z.string().optional(),
    }),
  )
  .handler(async ({ data }): Promise<OrderWithCustomer[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    let query = admin
      .from('orders')
      .select(
        '*, customer:customers(id, email, full_name), order_items(id, product_name_snapshot, variant_label_snapshot, quantity, variant_id), payments(status, created_at), shipments(status, carrier, tracking_number)',
      )
      .order('placed_at', { ascending: false })

    if (data.status) query = query.eq('status', data.status)
    if (data.source) query = query.eq('source', data.source)

    const search = data.q?.trim()
    if (search) {
      const [
        { data: matchingCustomers },
        { data: matchingItems },
        { data: matchingShipments },
      ] = await Promise.all([
        admin
          .from('customers')
          .select('id')
          .or(`email.ilike.%${search}%,full_name.ilike.%${search}%`),
        admin
          .from('order_items')
          .select('order_id')
          .or(
            `product_name_snapshot.ilike.%${search}%,sku_snapshot.ilike.%${search}%`,
          ),
        admin
          .from('shipments')
          .select('order_id')
          .ilike('tracking_number', `%${search}%`),
      ])
      const customerIds = (matchingCustomers ?? []).map((c) => c.id)
      const orderIdsFromItems = (matchingItems ?? []).map((i) => i.order_id)
      const orderIdsFromShipments = (matchingShipments ?? []).map(
        (s) => s.order_id,
      )
      const matchedOrderIds = Array.from(
        new Set([...orderIdsFromItems, ...orderIdsFromShipments]),
      )

      const orConditions = [
        `order_number.ilike.%${search}%`,
        `external_order_id.ilike.%${search}%`,
      ]
      if (customerIds.length > 0) {
        orConditions.push(`customer_id.in.(${customerIds.join(',')})`)
      }
      if (matchedOrderIds.length > 0) {
        orConditions.push(`id.in.(${matchedOrderIds.join(',')})`)
      }
      const searchAsDate = new Date(search)
      if (!Number.isNaN(searchAsDate.getTime())) {
        const dayStart = new Date(search)
        dayStart.setHours(0, 0, 0, 0)
        const dayEnd = new Date(search)
        dayEnd.setHours(23, 59, 59, 999)
        orConditions.push(
          `and(placed_at.gte.${dayStart.toISOString()},placed_at.lte.${dayEnd.toISOString()})`,
        )
      }
      query = query.or(orConditions.join(','))
    }

    const { data: rawOrders, error } = await query
    if (error) throw error

    const orders = data.fulfillment
      ? rawOrders.filter((o) => {
          const shipment = o.shipments[0]
          const isFulfilled =
            !!shipment && FULFILLED_SHIPMENT_STATUSES.has(shipment.status)
          return data.fulfillment === 'fulfilled' ? isFulfilled : !isFulfilled
        })
      : rawOrders

    const variantIds = Array.from(
      new Set(
        orders.flatMap((o) =>
          o.order_items
            .map((i) => i.variant_id)
            .filter((v): v is string => !!v),
        ),
      ),
    )
    const imageMap = await getProductImagesByVariantId(admin, variantIds)

    return orders.map((order) => ({
      ...order,
      order_items: order.order_items.map((item) => ({
        ...item,
        image_url: item.variant_id
          ? (imageMap.get(item.variant_id) ?? null)
          : null,
      })),
    }))
  })

export interface OrdersOverview {
  range: { from: string; to: string }
  orders: { count: number; previousCount: number; daily: number[] }
  itemsOrdered: { count: number; previousCount: number }
  returns: { count: number; previousCount: number }
  fulfilled: { count: number; previousCount: number }
  delivered: { count: number; previousCount: number }
  avgFulfillmentHours: number | null
}

export const getOrdersOverview = createServerFn({ method: 'GET' })
  .validator(z.object({ from: z.string(), to: z.string() }))
  .handler(async ({ data }): Promise<OrdersOverview> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const prev = previousPeriod(data.from, data.to)
    const rangeStart = `${data.from}T00:00:00.000Z`
    const rangeEnd = `${data.to}T23:59:59.999Z`
    const prevStart = `${prev.from}T00:00:00.000Z`
    const prevEnd = `${prev.to}T23:59:59.999Z`

    const [current, previous, returnsCurrent, returnsPrevious] =
      await Promise.all([
        admin
          .from('orders')
          .select(
            'id, placed_at, order_items(quantity), shipments(status, shipped_at)',
          )
          .gte('placed_at', rangeStart)
          .lte('placed_at', rangeEnd),
        admin
          .from('orders')
          .select('id, order_items(quantity), shipments(status)')
          .gte('placed_at', prevStart)
          .lte('placed_at', prevEnd),
        admin
          .from('returns')
          .select('*', { count: 'exact', head: true })
          .gte('requested_at', rangeStart)
          .lte('requested_at', rangeEnd),
        admin
          .from('returns')
          .select('*', { count: 'exact', head: true })
          .gte('requested_at', prevStart)
          .lte('requested_at', prevEnd),
      ])

    if (current.error) throw current.error
    if (previous.error) throw previous.error
    if (returnsCurrent.error) throw returnsCurrent.error
    if (returnsPrevious.error) throw returnsPrevious.error

    const dailyMap = new Map<string, number>()
    for (
      const d = new Date(`${data.from}T00:00:00`);
      d <= new Date(`${data.to}T00:00:00`);
      d.setDate(d.getDate() + 1)
    ) {
      dailyMap.set(d.toISOString().slice(0, 10), 0)
    }

    let itemsOrdered = 0
    let fulfilled = 0
    let delivered = 0
    const fulfillmentHours: number[] = []

    for (const order of current.data) {
      const day = order.placed_at.slice(0, 10)
      if (dailyMap.has(day)) dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1)

      itemsOrdered += order.order_items.reduce((sum, i) => sum + i.quantity, 0)

      const shipment = order.shipments[0]
      if (shipment && FULFILLED_SHIPMENT_STATUSES.has(shipment.status)) {
        fulfilled += 1
      }
      if (shipment?.status === 'delivered') delivered += 1
      if (shipment?.shipped_at) {
        const hours =
          (new Date(shipment.shipped_at).getTime() -
            new Date(order.placed_at).getTime()) /
          3_600_000
        fulfillmentHours.push(hours)
      }
    }

    let previousItemsOrdered = 0
    let previousFulfilled = 0
    for (const order of previous.data) {
      previousItemsOrdered += order.order_items.reduce(
        (sum, i) => sum + i.quantity,
        0,
      )
      const shipment = order.shipments[0]
      if (shipment && FULFILLED_SHIPMENT_STATUSES.has(shipment.status)) {
        previousFulfilled += 1
      }
    }
    const previousDelivered = previous.data.filter(
      (o) => o.shipments[0]?.status === 'delivered',
    ).length

    return {
      range: { from: data.from, to: data.to },
      orders: {
        count: current.data.length,
        previousCount: previous.data.length,
        daily: Array.from(dailyMap.values()),
      },
      itemsOrdered: {
        count: itemsOrdered,
        previousCount: previousItemsOrdered,
      },
      returns: {
        count: returnsCurrent.count ?? 0,
        previousCount: returnsPrevious.count ?? 0,
      },
      fulfilled: { count: fulfilled, previousCount: previousFulfilled },
      delivered: { count: delivered, previousCount: previousDelivered },
      avgFulfillmentHours:
        fulfillmentHours.length > 0
          ? fulfillmentHours.reduce((sum, h) => sum + h, 0) /
            fulfillmentHours.length
          : null,
    }
  })

export const getOrderById = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }): Promise<OrderWithDetails | null> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const { data: order, error } = await admin
      .from('orders')
      .select(
        '*, customer:customers(*), order_items(*), payments(*), shipments(*)',
      )
      .eq('id', data.id)
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
      ...order,
      order_items: order.order_items.map((item) => ({
        ...item,
        image_url: item.variant_id
          ? (imageMap.get(item.variant_id) ?? null)
          : null,
      })),
    }
  })

export interface BulkFulfillmentOrder {
  id: string
  order_number: string
  shipping_address: Record<string, unknown>
  customer: Pick<Customer, 'full_name' | 'email' | 'phone'>
  order_items: Pick<
    OrderItem,
    'id' | 'product_name_snapshot' | 'variant_label_snapshot' | 'quantity'
  >[]
  shipments: Pick<
    Shipment,
    'carrier' | 'tracking_number' | 'tracking_url' | 'status'
  >[]
}

export const getOrdersForBulkFulfillment = createServerFn({ method: 'GET' })
  .validator(z.object({ orderIds: z.array(z.string().uuid()).min(1) }))
  .handler(async ({ data }): Promise<BulkFulfillmentOrder[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const { data: orders, error } = await admin
      .from('orders')
      .select(
        'id, order_number, shipping_address, customer:customers(full_name, email, phone), order_items(id, product_name_snapshot, variant_label_snapshot, quantity), shipments(carrier, tracking_number, tracking_url, status)',
      )
      .in('id', data.orderIds)
      .order('placed_at', { ascending: false })
    if (error) throw error
    return orders
  })

export const updateOrderStatus = createServerFn({ method: 'POST' })
  .validator(orderStatusUpdateSchema)
  .handler(async ({ data }): Promise<Order> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: current, error: readError } = await admin
      .from('orders')
      .select('status')
      .eq('id', data.orderId)
      .single()
    if (readError) throw readError

    const currentStatus = current.status as OrderStatus
    if (!ALLOWED_TRANSITIONS[currentStatus].includes(data.status)) {
      throw new Error(
        `Cannot move an order from "${currentStatus}" to "${data.status}"`,
      )
    }

    const { data: order, error } = await admin
      .from('orders')
      .update({
        status: data.status,
        cancelled_at:
          data.status === 'cancelled' ? new Date().toISOString() : undefined,
      })
      .eq('id', data.orderId)
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(staff, 'order.status_update', 'orders', order.id, {
      from: currentStatus,
      to: data.status,
    })
    return order
  })

export const upsertShipment = createServerFn({ method: 'POST' })
  .validator(shipmentUpdateSchema)
  .handler(async ({ data }): Promise<Shipment> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: existing, error: readError } = await admin
      .from('shipments')
      .select('id')
      .eq('order_id', data.orderId)
      .maybeSingle<{ id: string }>()
    if (readError) throw readError

    const now = new Date().toISOString()
    const patch = {
      order_id: data.orderId,
      carrier: data.carrier ?? null,
      tracking_number: data.trackingNumber ?? null,
      tracking_url: data.trackingUrl ?? null,
      status: data.status,
      shipped_at: data.status === 'in_transit' ? now : undefined,
      delivered_at: data.status === 'delivered' ? now : undefined,
    }

    const { data: shipment, error } = existing
      ? await admin
          .from('shipments')
          .update(patch)
          .eq('id', existing.id)
          .select('*')
          .single()
      : await admin.from('shipments').insert(patch).select('*').single()
    if (error) throw error

    await logStaffActivity(
      staff,
      'order.shipment_update',
      'shipments',
      shipment.id,
      {
        orderId: data.orderId,
        status: data.status,
      },
    )

    // Tell the order's originating channel (TikTok Shop etc.) it's shipped —
    // best-effort: a failure here (e.g. an unmapped carrier, or the platform
    // API rejecting the call) shouldn't block staff from recording the
    // shipment on our own side, so it's swallowed rather than thrown.
    await pushFulfillmentUpdate(data.orderId).catch(() => {})

    return shipment
  })

/**
 * Reverses stock for one cancelled order's line items. Orders still in
 * 'pending_payment' only ever had stock *reserved* (release_variant_stock
 * undoes that). Anything past that point (paid/processing/packed) went
 * through commit_variant_stock, which already decremented quantity_on_hand
 * — restock_variant_stock is the only way to put that back.
 */
async function restockCancelledOrder(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  orderId: string,
  currentStatus: OrderStatus,
  items: Pick<OrderItem, 'variant_id' | 'quantity'>[],
) {
  const wasCommitted = currentStatus !== 'pending_payment'
  for (const item of items) {
    if (!item.variant_id) continue
    const rpcName = wasCommitted
      ? 'restock_variant_stock'
      : 'release_variant_stock'
    await admin.rpc(rpcName, {
      p_variant_id: item.variant_id,
      p_quantity: item.quantity,
      p_reference_type: 'order_cancel',
      p_reference_id: orderId,
    })
  }
}

export const cancelOrder = createServerFn({ method: 'POST' })
  .validator(cancelOrderSchema)
  .handler(async ({ data }): Promise<Order> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: current, error: readError } = await admin
      .from('orders')
      .select('status')
      .eq('id', data.orderId)
      .single()
    if (readError) throw readError

    const currentStatus = current.status
    if (!ALLOWED_TRANSITIONS[currentStatus].includes('cancelled')) {
      throw new Error(`Cannot cancel an order with status "${currentStatus}"`)
    }

    if (data.restock) {
      const { data: items, error: itemsError } = await admin
        .from('order_items')
        .select('variant_id, quantity')
        .eq('order_id', data.orderId)
      if (itemsError) throw itemsError
      await restockCancelledOrder(admin, data.orderId, currentStatus, items)
    }

    const { data: order, error } = await admin
      .from('orders')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', data.orderId)
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(staff, 'order.cancel', 'orders', order.id, {
      from: currentStatus,
      restocked: data.restock,
    })
    return order
  })

export const bulkCancelOrders = createServerFn({ method: 'POST' })
  .validator(bulkCancelOrdersSchema)
  .handler(
    async ({ data }): Promise<{ cancelled: number; skipped: number }> => {
      const staff = await requireStaff(MANAGE_ROLES)
      const admin = getSupabaseAdminClient()

      const { data: orders, error: readError } = await admin
        .from('orders')
        .select('id, status')
        .in('id', data.orderIds)
      if (readError) throw readError

      const { data: allItems, error: itemsError } = data.restock
        ? await admin
            .from('order_items')
            .select('order_id, variant_id, quantity')
            .in('order_id', data.orderIds)
        : { data: [], error: null }
      if (itemsError) throw itemsError
      const itemsByOrder = new Map<string, typeof allItems>()
      for (const item of allItems) {
        const list = itemsByOrder.get(item.order_id) ?? []
        list.push(item)
        itemsByOrder.set(item.order_id, list)
      }

      let cancelled = 0
      let skipped = 0
      for (const order of orders) {
        const currentStatus = order.status
        if (!ALLOWED_TRANSITIONS[currentStatus].includes('cancelled')) {
          skipped += 1
          continue
        }

        if (data.restock) {
          await restockCancelledOrder(
            admin,
            order.id,
            currentStatus,
            itemsByOrder.get(order.id) ?? [],
          )
        }

        await admin
          .from('orders')
          .update({
            status: 'cancelled',
            cancelled_at: new Date().toISOString(),
          })
          .eq('id', order.id)

        await logStaffActivity(staff, 'order.cancel', 'orders', order.id, {
          from: currentStatus,
          restocked: data.restock,
          bulk: true,
        })
        cancelled += 1
      }

      return { cancelled, skipped }
    },
  )

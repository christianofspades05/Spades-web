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
import {
  previousPeriod,
  storeLocalDateKey,
  storeRangeToUtcBounds,
} from '#/lib/utils/date-range'
import { pushFulfillmentUpdate } from '#/server/integrations/marketplaces/sync-engine'
import { fetchAllRows } from '#/lib/utils/paginate'
import { sendEmail, withDisplayName } from '#/lib/email/resend'
import {
  shipmentTrackingEmailHtml,
  shipmentTrackingEmailSubject,
} from '#/lib/email/templates/shipment-tracking'
import type { OrderShippingAddress } from '#/lib/checkout/shipping-address'
import { logStaffActivity } from './activity-log'
import type {
  Customer,
  Order,
  OrderItem,
  OrderStatus,
  Payment,
  ReturnStatus,
  Shipment,
} from '#/types/entities'

const MANAGE_ROLES = ['super_admin', 'admin', 'manager', 'packer'] as const

// 'packed' deliberately excluded — a tracking label/courier assignment can
// exist before the courier actually collects the parcel, and that's not
// "fulfilled" yet (matches the same distinction the seller's Shopify-side
// sync app makes; see sync-engine.ts's syncFulfillmentInfo).
const FULFILLED_SHIPMENT_STATUSES = new Set([
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

export interface OrderWithCustomer extends Order {
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
export interface OrderReturn {
  id: string
  reason: string
  status: ReturnStatus
  quantity: number
  refund_amount_cents: number | null
  requested_at: string
  resolved_at: string | null
}

export interface OrderWithDetails extends Order {
  customer: Customer
  order_items: (OrderItem & { image_url: string | null })[]
  payments: Payment[]
  shipments: Shipment[]
  returns: OrderReturn[]
  /** Computed live from the customer's real order history, not the
   *  customers table's own counter columns — nothing currently keeps those
   *  maintained (see the same note in listCustomers below). */
  customerStats: { ordersCount: number; failedDeliveryCount: number }
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

const listOrdersFilterSchema = z.object({
  status: z.string().optional(),
  source: z.string().optional(),
  brand: z.string().optional(),
  fulfillment: z
    .enum([
      'unfulfilled',
      'fulfilled',
      'pending',
      'packed',
      'in_transit',
      'delivered',
    ])
    .optional(),
  q: z.string().optional(),
})

/**
 * Resolves the fulfillment filter, shared by both `listOrders` and
 * `getOrdersCount` so they filter identically. Returns `{ hasShipment }`
 * for "unfulfilled"/"fulfilled" (a plain boolean equality check against
 * orders.has_shipment), or `{ includeIds }` for a specific shipment status
 * (empty array means "no orders match"), or `{}` when no filter is set.
 */
async function resolveFulfillmentOrderIds(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  fulfillment: z.infer<typeof listOrdersFilterSchema>['fulfillment'],
): Promise<{
  excludeIds?: string[]
  includeIds?: string[]
  hasShipment?: boolean
}> {
  // 'fulfilled'/'unfulfilled' answer via orders.has_shipment (a plain
  // boolean column) instead of fetching every shipment's order_id — this
  // store has 3,000+ shipments, and passing that many ids as a REST
  // .in()/.not(in) filter blew past Supabase's request-URL length limit
  // ("414 Request-URI Too Large"). See 0048_orders_has_shipment.sql.
  if (fulfillment === 'unfulfilled' || fulfillment === 'fulfilled') {
    return { hasShipment: fulfillment === 'fulfilled' }
  }
  if (fulfillment) {
    const matching = await fetchAllRows((offset) =>
      admin
        .from('shipments')
        .select('order_id')
        .eq('status', fulfillment)
        .range(offset, offset + 999),
    )
    return { includeIds: matching.map((s) => s.order_id) }
  }
  return {}
}

/** Resolves the free-text search filter into a PostgREST `.or()` condition list, shared by `listOrders` and `getOrdersCount`. */
async function resolveSearchOrConditions(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  search: string,
): Promise<string[]> {
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
  const orderIdsFromShipments = (matchingShipments ?? []).map((s) => s.order_id)
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
    // Store-local day boundaries, not the host's local time — matches the
    // same PH (UTC+8) treatment used everywhere else `placed_at` gets
    // compared against a calendar date.
    const dateKey = searchAsDate.toISOString().slice(0, 10)
    const { start, end } = storeRangeToUtcBounds(dateKey, dateKey)
    orConditions.push(`and(placed_at.gte.${start},placed_at.lte.${end})`)
  }
  return orConditions
}

export const listOrders = createServerFn({ method: 'GET' })
  .validator(
    listOrdersFilterSchema.extend({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
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

    if (data.status) {
      query = query.eq('status', data.status)
    } else {
      // Cancelled/failed orders are real, permanent records (a customer
      // request, a failed delivery, a marketplace cancellation) and stay
      // fully visible via the Payment filter — they're just excluded from
      // the unfiltered default view so it isn't dominated by void orders.
      query = query.not('status', 'in', '(cancelled,failed)')
    }
    if (data.source) query = query.eq('source', data.source)
    if (data.brand) query = query.eq('brand', data.brand)

    const { excludeIds, includeIds, hasShipment } =
      await resolveFulfillmentOrderIds(admin, data.fulfillment)
    if (hasShipment !== undefined) {
      query = query.eq('has_shipment', hasShipment)
    }
    if (excludeIds && excludeIds.length > 0) {
      query = query.not('id', 'in', `(${excludeIds.join(',')})`)
    }
    if (includeIds) {
      if (includeIds.length === 0) return []
      query = query.in('id', includeIds)
    }

    const search = data.q?.trim()
    if (search) {
      const orConditions = await resolveSearchOrConditions(admin, search)
      query = query.or(orConditions.join(','))
    }

    const offset = (data.page - 1) * data.pageSize
    query = query.range(offset, offset + data.pageSize - 1)

    const { data: orders, error } = await query
    if (error) throw error

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

// Kept as a separate, simple head-count query (no embedded joins) rather
// than folded into `listOrders`'s response — bundling a row array and a
// count into one return object broke TypeScript's inference for this
// handler (the embedded-relation row type is already at the edge of what it
// can resolve; wrapping it in another object tipped it over to `unknown`).
export const getOrdersCount = createServerFn({ method: 'GET' })
  .validator(listOrdersFilterSchema)
  .handler(async ({ data }): Promise<{ total: number }> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    let query = admin
      .from('orders')
      .select('id', { count: 'exact', head: true })

    if (data.status) {
      query = query.eq('status', data.status)
    } else {
      query = query.not('status', 'in', '(cancelled,failed)')
    }
    if (data.source) query = query.eq('source', data.source)
    if (data.brand) query = query.eq('brand', data.brand)

    const { excludeIds, includeIds, hasShipment } =
      await resolveFulfillmentOrderIds(admin, data.fulfillment)
    if (hasShipment !== undefined) {
      query = query.eq('has_shipment', hasShipment)
    }
    if (excludeIds && excludeIds.length > 0) {
      query = query.not('id', 'in', `(${excludeIds.join(',')})`)
    }
    if (includeIds) {
      if (includeIds.length === 0) return { total: 0 }
      query = query.in('id', includeIds)
    }

    const search = data.q?.trim()
    if (search) {
      const orConditions = await resolveSearchOrConditions(admin, search)
      query = query.or(orConditions.join(','))
    }

    const { count, error } = await query
    if (error) throw error
    return { total: count ?? 0 }
  })

export interface OrdersOverview {
  range: { from: string; to: string }
  orders: { count: number; previousCount: number; daily: number[] }
  itemsOrdered: { count: number; previousCount: number }
  returns: { count: number; previousCount: number }
  fulfilled: { count: number; previousCount: number }
  delivered: { count: number; previousCount: number }
  failedOrCancelled: { count: number; previousCount: number }
}

// Brief in-process cache so repeated loads of the same date range (e.g. every
// staff member landing on the default "Last 30 days" view) don't re-run the
// full row scan each time. This only helps within a single warm serverless
// instance — it's not a shared/global cache — but Vercel reuses warm
// instances for bursts of traffic, which is exactly when this matters most.
const OVERVIEW_CACHE_TTL_MS = 2 * 60_000
const overviewCache = new Map<
  string,
  { expiresAt: number; data: OrdersOverview }
>()

export const getOrdersOverview = createServerFn({ method: 'GET' })
  .validator(z.object({ from: z.string(), to: z.string() }))
  .handler(async ({ data }): Promise<OrdersOverview> => {
    await requireStaff()

    const cacheKey = `${data.from}|${data.to}`
    const cached = overviewCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.data

    const admin = getSupabaseAdminClient()

    const prev = previousPeriod(data.from, data.to)
    const { start: rangeStart, end: rangeEnd } = storeRangeToUtcBounds(
      data.from,
      data.to,
    )
    const { start: prevStart, end: prevEnd } = storeRangeToUtcBounds(
      prev.from,
      prev.to,
    )

    const [currentOrders, previousOrders, returnsCurrent, returnsPrevious] =
      await Promise.all([
        fetchAllRows((offset) =>
          admin
            .from('orders')
            .select(
              'id, status, placed_at, order_items(quantity), shipments(status, shipped_at)',
            )
            .gte('placed_at', rangeStart)
            .lte('placed_at', rangeEnd)
            .range(offset, offset + 999),
        ),
        fetchAllRows((offset) =>
          admin
            .from('orders')
            .select('id, status, order_items(quantity), shipments(status)')
            .gte('placed_at', prevStart)
            .lte('placed_at', prevEnd)
            .range(offset, offset + 999),
        ),
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

    if (returnsCurrent.error) throw returnsCurrent.error
    if (returnsPrevious.error) throw returnsPrevious.error

    const dailyMap = new Map<string, number>()
    for (
      const d = new Date(`${data.from}T00:00:00Z`);
      d <= new Date(`${data.to}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      dailyMap.set(d.toISOString().slice(0, 10), 0)
    }

    let itemsOrdered = 0
    let fulfilled = 0
    let delivered = 0
    let failedOrCancelled = 0

    for (const order of currentOrders) {
      const day = storeLocalDateKey(order.placed_at)
      if (dailyMap.has(day)) dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1)

      itemsOrdered += order.order_items.reduce((sum, i) => sum + i.quantity, 0)

      const shipment = order.shipments.at(0)
      if (shipment && FULFILLED_SHIPMENT_STATUSES.has(shipment.status)) {
        fulfilled += 1
      }
      if (shipment?.status === 'delivered') delivered += 1
      if (order.status === 'cancelled' || order.status === 'failed') {
        failedOrCancelled += 1
      }
    }

    let previousItemsOrdered = 0
    let previousFulfilled = 0
    let previousFailedOrCancelled = 0
    for (const order of previousOrders) {
      previousItemsOrdered += order.order_items.reduce(
        (sum, i) => sum + i.quantity,
        0,
      )
      const shipment = order.shipments.at(0)
      if (shipment && FULFILLED_SHIPMENT_STATUSES.has(shipment.status)) {
        previousFulfilled += 1
      }
      if (order.status === 'cancelled' || order.status === 'failed') {
        previousFailedOrCancelled += 1
      }
    }
    const previousDelivered = previousOrders.filter(
      (o) => o.shipments.at(0)?.status === 'delivered',
    ).length

    const result: OrdersOverview = {
      range: { from: data.from, to: data.to },
      orders: {
        count: currentOrders.length,
        previousCount: previousOrders.length,
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
      failedOrCancelled: {
        count: failedOrCancelled,
        previousCount: previousFailedOrCancelled,
      },
    }
    overviewCache.set(cacheKey, {
      data: result,
      expiresAt: Date.now() + OVERVIEW_CACHE_TTL_MS,
    })
    return result
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
    const [
      imageMap,
      { data: customerOrders, error: customerOrdersError },
      { data: returns, error: returnsError },
    ] = await Promise.all([
      getProductImagesByVariantId(admin, variantIds),
      admin
        .from('orders')
        .select('status, cancellation_reason')
        .eq('customer_id', order.customer_id),
      admin
        .from('returns')
        .select(
          'id, reason, status, quantity, refund_amount_cents, requested_at, resolved_at',
        )
        .eq('order_id', data.id)
        .order('requested_at', { ascending: false }),
    ])
    if (customerOrdersError) throw customerOrdersError
    if (returnsError) throw returnsError

    const failedDeliveryCount = customerOrders.filter(
      (o) =>
        o.status === 'cancelled' && o.cancellation_reason === 'failed_delivery',
    ).length

    return {
      ...order,
      order_items: order.order_items.map((item) => ({
        ...item,
        image_url: item.variant_id
          ? (imageMap.get(item.variant_id) ?? null)
          : null,
      })),
      returns,
      customerStats: {
        ordersCount: customerOrders.length,
        failedDeliveryCount,
      },
    }
  })

export interface AdjacentOrderIds {
  previousOrderId: string | null
  nextOrderId: string | null
}

/**
 * "Previous"/"Next" relative to the order list's default sort (newest
 * first): previous is the next-newer order, next is the next-older one —
 * so stepping "Next" repeatedly walks the same direction paging through the
 * list would. Not scoped to whatever filters were active on the list page
 * the staff member came from — just global adjacency by placed_at.
 */
export const getAdjacentOrderIds = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }): Promise<AdjacentOrderIds> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const { data: current, error: currentError } = await admin
      .from('orders')
      .select('placed_at')
      .eq('id', data.id)
      .maybeSingle()
    if (currentError) throw currentError
    if (!current) return { previousOrderId: null, nextOrderId: null }

    const [
      { data: previous, error: previousError },
      { data: next, error: nextError },
    ] = await Promise.all([
      admin
        .from('orders')
        .select('id')
        .gt('placed_at', current.placed_at)
        .order('placed_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      admin
        .from('orders')
        .select('id')
        .lt('placed_at', current.placed_at)
        .order('placed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (previousError) throw previousError
    if (nextError) throw nextError

    return {
      previousOrderId: previous?.id ?? null,
      nextOrderId: next?.id ?? null,
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

    const currentStatus = current.status
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
      .select('id, tracking_number')
      .eq('order_id', data.orderId)
      .maybeSingle<{ id: string; tracking_number: string | null }>()
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

    // Only email when a tracking number actually just appeared/changed —
    // not on every status edit (e.g. in_transit -> delivered) for the same
    // number, which would otherwise re-notify the customer for no reason.
    const trackingChanged =
      Boolean(data.trackingNumber) &&
      data.trackingNumber !== existing?.tracking_number
    if (trackingChanged) {
      const { data: order } = await admin
        .from('orders')
        .select('order_number, shipping_address, source')
        .eq('id', data.orderId)
        .maybeSingle()
      // Shopee/TikTok orders carry the marketplace's own anonymized relay
      // address (e.g. ...@scs2.tiktok.com), never the buyer's real inbox —
      // same reasoning as the review-request cron skipping these sources
      // (see routes/api/cron/review-requests.ts). Those customers already
      // get tracking updates through the marketplace app itself.
      if (
        order &&
        order.source !== 'tiktok_shop' &&
        order.source !== 'shopee' &&
        order.source !== 'lazada'
      ) {
        const address =
          order.shipping_address as unknown as OrderShippingAddress
        void sendEmail({
          to: address.email,
          subject: shipmentTrackingEmailSubject(order.order_number),
          from: withDisplayName(
            'Spades Official Orders',
            process.env.RESEND_FROM_EMAIL_ORDERS,
          ),
          html: shipmentTrackingEmailHtml({
            orderNumber: order.order_number,
            carrier: data.carrier ?? null,
            trackingNumber: data.trackingNumber as string,
            trackingUrl: data.trackingUrl ?? null,
          }),
        }).catch((err: unknown) => {
          console.error('Failed to send shipment tracking email:', err)
        })
      }
    }

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
  const rpcName = wasCommitted
    ? 'restock_variant_stock'
    : 'release_variant_stock'
  const itemsWithVariant: { variant_id: string; quantity: number }[] = []
  for (const item of items) {
    if (item.variant_id) {
      itemsWithVariant.push({
        variant_id: item.variant_id,
        quantity: item.quantity,
      })
    }
  }
  await Promise.all(
    itemsWithVariant.map((item) =>
      admin.rpc(rpcName, {
        p_variant_id: item.variant_id,
        p_quantity: item.quantity,
        p_reference_type: 'order_cancel',
        p_reference_id: orderId,
      }),
    ),
  )
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
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: data.reason,
      })
      .eq('id', data.orderId)
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(staff, 'order.cancel', 'orders', order.id, {
      from: currentStatus,
      restocked: data.restock,
      reason: data.reason,
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

      // Each order is independent, so cancelling them one at a time bought
      // nothing but latency — a bulk selection of 20+ orders was paying a
      // full round trip per order, sequentially.
      const wasCancelled: boolean[] = await Promise.all(
        orders.map(async (order) => {
          const currentStatus = order.status
          if (!ALLOWED_TRANSITIONS[currentStatus].includes('cancelled')) {
            return false
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
              cancellation_reason: data.reason,
            })
            .eq('id', order.id)

          await logStaffActivity(staff, 'order.cancel', 'orders', order.id, {
            from: currentStatus,
            restocked: data.restock,
            reason: data.reason,
            bulk: true,
          })
          return true
        }),
      )

      const cancelled = wasCancelled.filter(Boolean).length
      const skipped = wasCancelled.length - cancelled

      return { cancelled, skipped }
    },
  )

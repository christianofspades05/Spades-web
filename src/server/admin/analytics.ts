import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import {
  daysAgo,
  previousPeriod,
  storeLocalDateKey,
  storeLocalHourKey,
  storeRangeToUtcBounds,
} from '#/lib/utils/date-range'
import { chunkArray, fetchAllRows } from '#/lib/utils/paginate'
import { createTtlCache } from '#/lib/utils/cache'
import { STOREFRONT_BRANDS } from '#/lib/validation/admin/storefront-sections'
import type {
  OrderCancellationReason,
  OrderSource,
  OrderStatus,
} from '#/types/entities'

const VOID_STATUSES = new Set(['cancelled', 'failed'])
const ORDER_ID_CHUNK_SIZE = 200
const ANALYTICS_CACHE_TTL_MS = 2 * 60_000

/**
 * Whether an order's shipping fee is part of the sale for Gross Sales
 * purposes. Online Store (storefront/admin) bills shipping directly to the
 * buyer as part of the order total, so it belongs in gross sales. TikTok
 * Shop/Shopee/Lazada shipping is arranged and billed by the platform itself
 * — it's not revenue we ever see a cut of — so it's excluded there, per the
 * seller's confirmed formula (Online Store: item amount + shipping = gross
 * sales; marketplaces: item amount only = gross sales).
 */
const GROSS_SALES_INCLUDES_SHIPPING = new Set<OrderSource>([
  'storefront',
  'admin',
])

/**
 * Gross Sales for one order: total item amount (orders.subtotal_cents,
 * always pre-discount — see NormalizedOrder.subtotalCents for how
 * marketplace imports populate this the same way storefront checkout does),
 * plus shipping only where the channel bills it as part of the sale.
 */
function grossSalesCentsForOrder(order: {
  source: OrderSource
  subtotal_cents: number
  shipping_cents: number
}): number {
  return GROSS_SALES_INCLUDES_SHIPPING.has(order.source)
    ? order.subtotal_cents + order.shipping_cents
    : order.subtotal_cents
}

export interface ChannelSales {
  source: OrderSource
  grossSalesCents: number
  discountCents: number
  netSalesCents: number
  costOfGoodsCents: number
  netProfitCents: number
  marginPct: number | null
  orderCount: number
}

export interface ProfitDailyPoint {
  date: string
  grossSalesCents: number
  costOfGoodsCents: number
  netProfitCents: number
  marginPct: number | null
}

export interface SalesByChannelResult {
  range: { from: string; to: string }
  channels: ChannelSales[]
  totals: {
    grossSalesCents: number
    costOfGoodsCents: number
    netProfitCents: number
    marginPct: number | null
    orderCount: number
  }
  daily: ProfitDailyPoint[]
  previous: {
    channels: ChannelSales[]
    totals: {
      grossSalesCents: number
      costOfGoodsCents: number
      netProfitCents: number
      marginPct: number | null
      orderCount: number
    }
    daily: ProfitDailyPoint[]
  } | null
}

/**
 * Computes gross sales, COGS, and net profit per channel for a date range.
 * Avoids embedded-relation selects (orders/order_items/product_variants
 * joined in one query) since orders' Relationships metadata is empty in
 * database.types.ts, which breaks TypeScript's inference for that shape —
 * see the same workaround already used throughout src/server/admin/orders.ts.
 * Instead this does three flat queries and joins them in memory.
 */
async function computeChannelSales(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  from: string,
  to: string,
  channelFilter: OrderSource | undefined,
  brandFilter: string | undefined,
): Promise<{
  channels: ChannelSales[]
  totals: ChannelSales
  daily: ProfitDailyPoint[]
}> {
  const { start: rangeStart, end: rangeEnd } = storeRangeToUtcBounds(from, to)

  const orders = await fetchAllRows((offset) => {
    let orderQuery = admin
      .from('orders')
      .select(
        'id, source, subtotal_cents, discount_cents, shipping_cents, status, placed_at',
      )
      .gte('placed_at', rangeStart)
      .lte('placed_at', rangeEnd)
      .range(offset, offset + 999)
    if (channelFilter) orderQuery = orderQuery.eq('source', channelFilter)
    if (brandFilter) orderQuery = orderQuery.eq('brand', brandFilter)
    return orderQuery
  })

  const liveOrders = orders.filter((o) => !VOID_STATUSES.has(o.status))
  const orderIds = liveOrders.map((o) => o.id)

  // A marketplace return (buyer-initiated, tracked in `returns` rather than
  // by flipping the order's own status — see sync-engine.ts's comment on
  // why full-order status isn't used, since a return can be partial) still
  // shows the order's original total_cents unless the refunded amount is
  // subtracted back out here. Neither this nor the order_items fetch below
  // depends on the other — both only need orderIds — so they run
  // concurrently instead of one after the other.
  //
  // order_items outnumbers orders (most orders have multiple line items),
  // so this table crosses the 1000-row cap before orders itself does — the
  // select's own row cap is the risk within each chunk, which is why this
  // still wraps every chunk in fetchAllRows. The chunking itself guards
  // against a different limit: a wide date range can produce enough order
  // ids that a single .in('order_id', orderIds) query string gets rejected
  // outright (same failure mode fixed on the customers page).
  const [refundChunks, itemChunks] = await Promise.all([
    Promise.all(
      chunkArray(orderIds, ORDER_ID_CHUNK_SIZE).map((ids) =>
        fetchAllRows((offset) =>
          admin
            .from('returns')
            .select('order_id, refund_amount_cents')
            .eq('status', 'refunded')
            .in('order_id', ids)
            .range(offset, offset + 999),
        ),
      ),
    ),
    Promise.all(
      chunkArray(orderIds, ORDER_ID_CHUNK_SIZE).map((ids) =>
        fetchAllRows((offset) =>
          admin
            .from('order_items')
            .select('order_id, variant_id, quantity')
            .in('order_id', ids)
            .range(offset, offset + 999),
        ),
      ),
    ),
  ])
  const refundByOrderId = new Map<string, number>()
  for (const ret of refundChunks.flat()) {
    const current = refundByOrderId.get(ret.order_id) ?? 0
    refundByOrderId.set(ret.order_id, current + (ret.refund_amount_cents ?? 0))
  }
  const items = itemChunks.flat()

  const variantIds = Array.from(
    new Set(
      items.map((i) => i.variant_id).filter((v): v is string => v !== null),
    ),
  )
  const { data: variants, error: variantsError } =
    variantIds.length > 0
      ? await admin
          .from('product_variants')
          .select('id, cost_cents')
          .in('id', variantIds)
      : { data: [], error: null }
  if (variantsError) throw variantsError
  const costByVariantId = new Map(variants.map((v) => [v.id, v.cost_cents]))

  const cogsByOrderId = new Map<string, number>()
  for (const item of items) {
    const cost = item.variant_id
      ? (costByVariantId.get(item.variant_id) ?? 0)
      : 0
    const current = cogsByOrderId.get(item.order_id) ?? 0
    cogsByOrderId.set(item.order_id, current + cost * item.quantity)
  }

  const bySource = new Map<
    OrderSource,
    {
      grossSalesCents: number
      discountCents: number
      refundCents: number
      costOfGoodsCents: number
      orderCount: number
    }
  >()
  for (const order of liveOrders) {
    const bucket = bySource.get(order.source) ?? {
      grossSalesCents: 0,
      discountCents: 0,
      refundCents: 0,
      costOfGoodsCents: 0,
      orderCount: 0,
    }
    bucket.grossSalesCents += grossSalesCentsForOrder(order)
    bucket.discountCents += order.discount_cents
    bucket.refundCents += refundByOrderId.get(order.id) ?? 0
    bucket.costOfGoodsCents += cogsByOrderId.get(order.id) ?? 0
    bucket.orderCount += 1
    bySource.set(order.source, bucket)
  }

  const channels: ChannelSales[] = Array.from(bySource.entries())
    .map(([source, b]) => {
      const netSalesCents = b.grossSalesCents - b.discountCents - b.refundCents
      const netProfitCents = netSalesCents - b.costOfGoodsCents
      return {
        source,
        grossSalesCents: b.grossSalesCents,
        discountCents: b.discountCents,
        netSalesCents,
        costOfGoodsCents: b.costOfGoodsCents,
        netProfitCents,
        marginPct:
          b.grossSalesCents > 0
            ? (netProfitCents / b.grossSalesCents) * 100
            : null,
        orderCount: b.orderCount,
      }
    })
    .sort((a, b) => b.grossSalesCents - a.grossSalesCents)

  const totalsRaw = channels.reduce(
    (sum, c) => ({
      grossSalesCents: sum.grossSalesCents + c.grossSalesCents,
      discountCents: sum.discountCents + c.discountCents,
      netSalesCents: sum.netSalesCents + c.netSalesCents,
      costOfGoodsCents: sum.costOfGoodsCents + c.costOfGoodsCents,
      netProfitCents: sum.netProfitCents + c.netProfitCents,
      orderCount: sum.orderCount + c.orderCount,
    }),
    {
      grossSalesCents: 0,
      discountCents: 0,
      netSalesCents: 0,
      costOfGoodsCents: 0,
      netProfitCents: 0,
      orderCount: 0,
    },
  )
  const totals: ChannelSales = {
    source: 'storefront',
    grossSalesCents: totalsRaw.grossSalesCents,
    discountCents: totalsRaw.discountCents,
    netSalesCents: totalsRaw.netSalesCents,
    costOfGoodsCents: totalsRaw.costOfGoodsCents,
    netProfitCents: totalsRaw.netProfitCents,
    marginPct:
      totalsRaw.grossSalesCents > 0
        ? (totalsRaw.netProfitCents / totalsRaw.grossSalesCents) * 100
        : null,
    orderCount: totalsRaw.orderCount,
  }

  // Bucketed by day so days with zero orders still show up as a zero point
  // rather than being missing from the chart entirely.
  const dailyMap = new Map<
    string,
    {
      grossSalesCents: number
      discountCents: number
      refundCents: number
      costOfGoodsCents: number
    }
  >()
  for (
    const d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    dailyMap.set(d.toISOString().slice(0, 10), {
      grossSalesCents: 0,
      discountCents: 0,
      refundCents: 0,
      costOfGoodsCents: 0,
    })
  }
  for (const order of liveOrders) {
    const key = storeLocalDateKey(order.placed_at)
    const bucket = dailyMap.get(key)
    if (!bucket) continue
    bucket.grossSalesCents += grossSalesCentsForOrder(order)
    bucket.discountCents += order.discount_cents
    bucket.refundCents += refundByOrderId.get(order.id) ?? 0
    bucket.costOfGoodsCents += cogsByOrderId.get(order.id) ?? 0
  }
  const daily: ProfitDailyPoint[] = Array.from(dailyMap.entries()).map(
    ([date, b]) => {
      const netProfitCents =
        b.grossSalesCents - b.discountCents - b.refundCents - b.costOfGoodsCents
      return {
        date,
        grossSalesCents: b.grossSalesCents,
        costOfGoodsCents: b.costOfGoodsCents,
        netProfitCents,
        marginPct:
          b.grossSalesCents > 0
            ? (netProfitCents / b.grossSalesCents) * 100
            : null,
      }
    },
  )

  return { channels, totals, daily }
}

export interface CancelledReturnsResult {
  range: { from: string; to: string }
  totalCancelled: number
  cancelledAmountCents: number
  /** Online Store "Failed Delivery" cancellations combined with TikTok/
   *  Shopee returns — different mechanisms recording the same underlying
   *  event (a parcel that came back instead of reaching the buyer). */
  failedDeliveryOrReturn: {
    total: number
    failedDeliveryCount: number
    failedDeliveryAmountCents: number
    marketplaceReturnsCount: number
  }
  daily: { date: string; count: number }[]
  previousDaily: { date: string; count: number }[]
  byReason: { reason: OrderCancellationReason | 'unspecified'; count: number }[]
  byChannel: { source: OrderSource; count: number }[]
  /** Same reason breakdown as byReason, but scoped to one channel at a time
   *  — powers the per-channel "cancellation reason" sections on the admin
   *  page, since byReason/byChannel alone can't answer "why is TikTok
   *  cancelling orders" on their own. */
  byChannelAndReason: {
    source: OrderSource
    total: number
    byReason: {
      reason: OrderCancellationReason | 'unspecified'
      count: number
    }[]
  }[]
  returns: {
    totalCount: number
    totalRefundCents: number
    byChannel: { source: OrderSource; count: number }[]
  }
  /** Full row-level detail behind byReason/byChannel/byChannelAndReason,
   *  for the admin page's click-a-bar-to-see-its-orders drill-down —
   *  filtered client-side rather than round-tripping per click. */
  cancelledOrdersList: {
    id: string
    orderNumber: string
    source: OrderSource
    reason: OrderCancellationReason | 'unspecified'
    cancelledAt: string | null
    totalCents: number
    customerName: string
  }[]
  returnsList: {
    id: string
    orderId: string
    orderNumber: string
    source: OrderSource | null
    refundAmountCents: number
    requestedAt: string
    customerName: string
  }[]
}

async function computeCancelledAndReturns(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  from: string,
  to: string,
  channelFilter: OrderSource | undefined,
): Promise<CancelledReturnsResult> {
  const { start: rangeStart, end: rangeEnd } = storeRangeToUtcBounds(from, to)

  // Neither of these depends on the other (different table, different date
  // column) — run concurrently rather than one after another.
  const [cancelledOrders, returnsRaw] = await Promise.all([
    fetchAllRows((offset) => {
      let query = admin
        .from('orders')
        .select(
          'id, order_number, source, cancellation_reason, cancelled_at, total_cents, customer:customers(full_name, email)',
        )
        .eq('status', 'cancelled')
        .gte('cancelled_at', rangeStart)
        .lte('cancelled_at', rangeEnd)
        .range(offset, offset + 999)
      if (channelFilter) query = query.eq('source', channelFilter)
      return query
    }),
    fetchAllRows((offset) =>
      admin
        .from('returns')
        .select('id, order_id, refund_amount_cents, requested_at')
        .gte('requested_at', rangeStart)
        .lte('requested_at', rangeEnd)
        .range(offset, offset + 999),
    ),
  ])

  // A single-day range (e.g. "Today") gets bucketed by hour instead of by
  // day — see the same treatment in dashboard.ts's getDashboardAnalytics.
  const isSingleDay = from === to
  const bucketKey = (iso: string) =>
    isSingleDay ? storeLocalHourKey(iso) : storeLocalDateKey(iso)

  const dailyMap = new Map<string, number>()
  if (isSingleDay) {
    for (let hour = 0; hour < 24; hour++) {
      dailyMap.set(`${from}T${String(hour).padStart(2, '0')}`, 0)
    }
  } else {
    for (
      const d = new Date(`${from}T00:00:00Z`);
      d <= new Date(`${to}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      dailyMap.set(d.toISOString().slice(0, 10), 0)
    }
  }
  const byReasonMap = new Map<OrderCancellationReason | 'unspecified', number>()
  const byChannelMap = new Map<OrderSource, number>()
  const byChannelAndReasonMap = new Map<
    OrderSource,
    Map<OrderCancellationReason | 'unspecified', number>
  >()

  let cancelledAmountCents = 0
  let failedDeliveryAmountCents = 0
  for (const order of cancelledOrders) {
    if (order.cancelled_at) {
      const key = bucketKey(order.cancelled_at)
      dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1)
    }
    const reasonKey = order.cancellation_reason ?? 'unspecified'
    byReasonMap.set(reasonKey, (byReasonMap.get(reasonKey) ?? 0) + 1)
    byChannelMap.set(order.source, (byChannelMap.get(order.source) ?? 0) + 1)

    const channelReasons = byChannelAndReasonMap.get(order.source) ?? new Map()
    channelReasons.set(reasonKey, (channelReasons.get(reasonKey) ?? 0) + 1)
    byChannelAndReasonMap.set(order.source, channelReasons)

    cancelledAmountCents += order.total_cents
    if (order.source === 'storefront' && reasonKey === 'failed_delivery') {
      failedDeliveryAmountCents += order.total_cents
    }
  }

  const returnOrderIds = Array.from(new Set(returnsRaw.map((r) => r.order_id)))
  const returnOrders =
    returnOrderIds.length > 0
      ? await fetchAllRows((offset) =>
          admin
            .from('orders')
            .select(
              'id, order_number, source, customer:customers(full_name, email)',
            )
            .in('id', returnOrderIds)
            .range(offset, offset + 999),
        )
      : []
  const sourceByOrderId = new Map(returnOrders.map((o) => [o.id, o.source]))
  const returnOrderById = new Map(returnOrders.map((o) => [o.id, o]))

  // Returns aren't tied to `orders.source` directly (see the join above),
  // so the channel filter has to be applied after that lookup rather than
  // as a query predicate.
  const returns = channelFilter
    ? returnsRaw.filter(
        (r) => sourceByOrderId.get(r.order_id) === channelFilter,
      )
    : returnsRaw

  const returnsByChannelMap = new Map<OrderSource, number>()
  let totalRefundCents = 0
  for (const ret of returns) {
    totalRefundCents += ret.refund_amount_cents ?? 0
    const source = sourceByOrderId.get(ret.order_id)
    if (source) {
      returnsByChannelMap.set(
        source,
        (returnsByChannelMap.get(source) ?? 0) + 1,
      )
    }
  }

  // A storefront order cancelled for failed delivery and a TikTok/Shopee
  // return are the same real-world event from the business's point of
  // view — a parcel that didn't reach the buyer and came back — just
  // recorded through two different mechanisms (a cancellation reason vs.
  // a marketplace return sync). Combined here so the two don't read as
  // unrelated numbers.
  const failedDeliveryCount =
    byChannelAndReasonMap.get('storefront')?.get('failed_delivery') ?? 0
  const marketplaceReturnsCount =
    (returnsByChannelMap.get('tiktok_shop') ?? 0) +
    (returnsByChannelMap.get('shopee') ?? 0)

  const cancelledOrdersList = cancelledOrders.map((order) => ({
    id: order.id,
    orderNumber: order.order_number,
    source: order.source,
    reason: order.cancellation_reason ?? ('unspecified' as const),
    cancelledAt: order.cancelled_at,
    totalCents: order.total_cents,
    customerName: order.customer.full_name ?? order.customer.email,
  }))

  const returnsList = returns.map((ret) => {
    const order = returnOrderById.get(ret.order_id)
    return {
      id: ret.id,
      orderId: ret.order_id,
      orderNumber: order?.order_number ?? '—',
      source: order?.source ?? null,
      refundAmountCents: ret.refund_amount_cents ?? 0,
      requestedAt: ret.requested_at,
      customerName:
        order?.customer.full_name ?? order?.customer.email ?? 'Guest',
    }
  })

  return {
    range: { from, to },
    totalCancelled: cancelledOrders.length,
    cancelledAmountCents,
    failedDeliveryOrReturn: {
      total: failedDeliveryCount + marketplaceReturnsCount,
      failedDeliveryCount,
      failedDeliveryAmountCents,
      marketplaceReturnsCount,
    },
    daily: Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => ({
        date: isSingleDay
          ? new Date(`${key}:00:00`).toLocaleTimeString('en-US', {
              hour: 'numeric',
            })
          : key,
        count,
      })),
    previousDaily: [],
    byReason: Array.from(byReasonMap.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    byChannel: Array.from(byChannelMap.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
    byChannelAndReason: Array.from(byChannelAndReasonMap.entries())
      .map(([source, reasonMap]) => ({
        source,
        total: Array.from(reasonMap.values()).reduce((a, b) => a + b, 0),
        byReason: Array.from(reasonMap.entries())
          .map(([reason, count]) => ({ reason, count }))
          .sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.total - a.total),
    returns: {
      totalCount: returns.length,
      totalRefundCents,
      byChannel: Array.from(returnsByChannelMap.entries())
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count),
    },
    cancelledOrdersList,
    returnsList,
  }
}

export const getCancelledAndReturns = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      from: z.string(),
      to: z.string(),
      channel: z
        .enum(['storefront', 'admin', 'tiktok_shop', 'shopee', 'lazada'])
        .optional(),
      comparePrevious: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }): Promise<CancelledReturnsResult> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const current = await computeCancelledAndReturns(
      admin,
      data.from,
      data.to,
      data.channel,
    )

    let previousDaily: CancelledReturnsResult['daily'] = []
    if (data.comparePrevious) {
      const prev = previousPeriod(data.from, data.to)
      const prevResult = await computeCancelledAndReturns(
        admin,
        prev.from,
        prev.to,
        data.channel,
      )
      previousDaily = prevResult.daily
    }

    return { ...current, previousDaily }
  })

export const getSalesByChannel = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      from: z.string(),
      to: z.string(),
      channel: z
        .enum(['storefront', 'admin', 'tiktok_shop', 'shopee', 'lazada'])
        .optional(),
      brand: z.string().optional(),
      comparePrevious: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }): Promise<SalesByChannelResult> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const current = await computeChannelSales(
      admin,
      data.from,
      data.to,
      data.channel,
      data.brand,
    )

    let previous: SalesByChannelResult['previous'] = null
    if (data.comparePrevious) {
      const prev = previousPeriod(data.from, data.to)
      const prevResult = await computeChannelSales(
        admin,
        prev.from,
        prev.to,
        data.channel,
        data.brand,
      )
      previous = {
        channels: prevResult.channels,
        totals: prevResult.totals,
        daily: prevResult.daily,
      }
    }

    return {
      range: { from: data.from, to: data.to },
      channels: current.channels,
      totals: current.totals,
      daily: current.daily,
      previous,
    }
  })

export interface CustomerTypeBucket {
  salesCents: number
  orderCount: number
  customerCount: number
}

export interface SalesByCustomerTypeResult {
  firstTime: CustomerTypeBucket
  repeat: CustomerTypeBucket
  /** (repeat customers ÷ all customers who ordered in this range) × 100 —
   *  null once no one ordered in the range at all. Reuses the exact same
   *  new/existing classification as firstTime/repeat above, so this number
   *  and the donut it sits next to are always consistent with each other. */
  retentionRatePct: number | null
}

/**
 * Splits this range's sales between customers who are ordering for the
 * very first time ever during it, and customers who already had at least
 * one order before the range started — classified per CUSTOMER, not per
 * order, so a returning customer's second order this period still counts
 * as "repeat" sales, and a brand-new customer's second order this same
 * period still counts as "first-time" sales (they were still acquired
 * during this window either way).
 */
export const getSalesByCustomerType = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      from: z.string(),
      to: z.string(),
      channel: z
        .enum(['storefront', 'admin', 'tiktok_shop', 'shopee', 'lazada'])
        .optional(),
      brand: z.string().optional(),
    }),
  )
  .handler(async ({ data }): Promise<SalesByCustomerTypeResult> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { start: rangeStart, end: rangeEnd } = storeRangeToUtcBounds(
      data.from,
      data.to,
    )

    const orders = await fetchAllRows((offset) => {
      let query = admin
        .from('orders')
        .select('customer_id, status, total_cents')
        .gte('placed_at', rangeStart)
        .lte('placed_at', rangeEnd)
        .range(offset, offset + 999)
      if (data.channel) query = query.eq('source', data.channel)
      if (data.brand) query = query.eq('brand', data.brand)
      return query
    })
    const liveOrders = orders.filter((o) => !VOID_STATUSES.has(o.status))
    const customerIds = Array.from(
      new Set(liveOrders.map((o) => o.customer_id)),
    )

    // Which of these customers already had a real order before this range
    // started — chunked to avoid a large .in() filter (see
    // resolveCollectionScopedProductIds's own comment on the same limit).
    const existingCustomerIds = new Set<string>()
    for (const idsChunk of chunkArray(customerIds, ORDER_ID_CHUNK_SIZE)) {
      const priorOrders = await fetchAllRows((offset) =>
        admin
          .from('orders')
          .select('customer_id, status')
          .in('customer_id', idsChunk)
          .lt('placed_at', rangeStart)
          .range(offset, offset + 999),
      )
      for (const order of priorOrders) {
        if (!VOID_STATUSES.has(order.status)) {
          existingCustomerIds.add(order.customer_id)
        }
      }
    }

    let firstTimeSalesCents = 0
    let firstTimeOrderCount = 0
    let repeatSalesCents = 0
    let repeatOrderCount = 0
    const firstTimeCustomers = new Set<string>()
    const repeatCustomers = new Set<string>()

    for (const order of liveOrders) {
      if (existingCustomerIds.has(order.customer_id)) {
        repeatSalesCents += order.total_cents
        repeatOrderCount += 1
        repeatCustomers.add(order.customer_id)
      } else {
        firstTimeSalesCents += order.total_cents
        firstTimeOrderCount += 1
        firstTimeCustomers.add(order.customer_id)
      }
    }

    const totalCustomers = firstTimeCustomers.size + repeatCustomers.size

    return {
      firstTime: {
        salesCents: firstTimeSalesCents,
        orderCount: firstTimeOrderCount,
        customerCount: firstTimeCustomers.size,
      },
      repeat: {
        salesCents: repeatSalesCents,
        orderCount: repeatOrderCount,
        customerCount: repeatCustomers.size,
      },
      retentionRatePct:
        totalCustomers > 0
          ? (repeatCustomers.size / totalCustomers) * 100
          : null,
    }
  })

export interface SalesAnalyticsTotals {
  grossSalesCents: number
  discountsCents: number
  refundsCents: number
  netSalesCents: number
  orderCount: number
  aovCents: number
  cancelledOrderCount: number
  cancelledAmountCents: number
  failedDeliveryCount: number
  failedDeliveryAmountCents: number
}

export interface SalesAnalyticsDailyPoint {
  date: string
  grossSalesCents: number
  netSalesCents: number
  orderCount: number
  aovCents: number
}

/**
 * Gross sales here is grossSalesCentsForOrder (channel-aware: shipping only
 * counts for Online Store, never for a marketplace — see that function's
 * doc comment), so Discounts can be broken out as its own line matching what
 * a Sales Analytics breakdown is expected to show. netSalesCents =
 * grossSalesCents - discounts - refunds; unlike total_cents this excludes a
 * marketplace's shipping fee entirely, since that was never our sale.
 */
async function computeSalesAnalytics(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  from: string,
  to: string,
  channelFilter: OrderSource | undefined,
  brandFilter: string | undefined,
): Promise<{
  totals: SalesAnalyticsTotals
  daily: SalesAnalyticsDailyPoint[]
}> {
  const { start: rangeStart, end: rangeEnd } = storeRangeToUtcBounds(from, to)

  // Cancellations are counted by when they were cancelled, not when the
  // order was originally placed (same distinction getCancelledAndReturns
  // makes) — an order placed weeks ago and cancelled today belongs in
  // today's cancellation count, not the day it was placed. That means this
  // needs its own range query rather than reusing the placed_at-filtered
  // `orders` fetched below. It doesn't depend on `orders` at all, so both
  // run concurrently instead of one after the other.
  const [orders, cancelledOrders] = await Promise.all([
    fetchAllRows((offset) => {
      let query = admin
        .from('orders')
        .select(
          'id, source, status, placed_at, subtotal_cents, discount_cents, shipping_cents, total_cents',
        )
        .gte('placed_at', rangeStart)
        .lte('placed_at', rangeEnd)
        .range(offset, offset + 999)
      if (channelFilter) query = query.eq('source', channelFilter)
      if (brandFilter) query = query.eq('brand', brandFilter)
      return query
    }),
    fetchAllRows((offset) => {
      let query = admin
        .from('orders')
        .select('id, source, cancellation_reason, total_cents')
        .eq('status', 'cancelled')
        .gte('cancelled_at', rangeStart)
        .lte('cancelled_at', rangeEnd)
        .range(offset, offset + 999)
      if (channelFilter) query = query.eq('source', channelFilter)
      if (brandFilter) query = query.eq('brand', brandFilter)
      return query
    }),
  ])

  const liveOrders = orders.filter((o) => !VOID_STATUSES.has(o.status))
  const orderIds = liveOrders.map((o) => o.id)

  const refundChunks = await Promise.all(
    chunkArray(orderIds, ORDER_ID_CHUNK_SIZE).map((ids) =>
      fetchAllRows((offset) =>
        admin
          .from('returns')
          .select('order_id, refund_amount_cents')
          .eq('status', 'refunded')
          .in('order_id', ids)
          .range(offset, offset + 999),
      ),
    ),
  )
  const refundByOrderId = new Map<string, number>()
  for (const ret of refundChunks.flat()) {
    const current = refundByOrderId.get(ret.order_id) ?? 0
    refundByOrderId.set(ret.order_id, current + (ret.refund_amount_cents ?? 0))
  }

  const cancelledOrderCount = cancelledOrders.length
  // What the order would have been worth had it gone through — the
  // customer-facing total, not gross-sales-minus-COGS, since this is meant
  // to answer "how much sales did we lose to cancellations."
  const cancelledAmountCents = cancelledOrders.reduce(
    (sum, o) => sum + o.total_cents,
    0,
  )
  const failedDeliveryOrders = cancelledOrders.filter(
    (o) =>
      o.source === 'storefront' && o.cancellation_reason === 'failed_delivery',
  )
  const failedDeliveryCount = failedDeliveryOrders.length
  const failedDeliveryAmountCents = failedDeliveryOrders.reduce(
    (sum, o) => sum + o.total_cents,
    0,
  )

  let grossSalesCents = 0
  let discountsCents = 0
  let refundsCents = 0
  for (const order of liveOrders) {
    grossSalesCents += grossSalesCentsForOrder(order)
    discountsCents += order.discount_cents
    refundsCents += refundByOrderId.get(order.id) ?? 0
  }
  const netSalesCents = grossSalesCents - discountsCents - refundsCents
  const orderCount = liveOrders.length
  const aovCents = orderCount > 0 ? Math.round(netSalesCents / orderCount) : 0

  const dailyMap = new Map<
    string,
    { grossSalesCents: number; netSalesCents: number; orderCount: number }
  >()
  for (
    const d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    dailyMap.set(d.toISOString().slice(0, 10), {
      grossSalesCents: 0,
      netSalesCents: 0,
      orderCount: 0,
    })
  }
  for (const order of liveOrders) {
    const key = storeLocalDateKey(order.placed_at)
    const bucket = dailyMap.get(key)
    if (!bucket) continue
    const grossCents = grossSalesCentsForOrder(order)
    bucket.grossSalesCents += grossCents
    bucket.netSalesCents +=
      grossCents - order.discount_cents - (refundByOrderId.get(order.id) ?? 0)
    bucket.orderCount += 1
  }
  const daily: SalesAnalyticsDailyPoint[] = Array.from(dailyMap.entries()).map(
    ([date, b]) => ({
      date,
      grossSalesCents: b.grossSalesCents,
      netSalesCents: b.netSalesCents,
      orderCount: b.orderCount,
      aovCents:
        b.orderCount > 0 ? Math.round(b.netSalesCents / b.orderCount) : 0,
    }),
  )

  return {
    totals: {
      grossSalesCents,
      discountsCents,
      refundsCents,
      netSalesCents,
      orderCount,
      aovCents,
      cancelledOrderCount,
      cancelledAmountCents,
      failedDeliveryCount,
      failedDeliveryAmountCents,
    },
    daily,
  }
}

export interface SalesAnalyticsResult {
  range: { from: string; to: string }
  totals: SalesAnalyticsTotals
  previousTotals: SalesAnalyticsTotals | null
  daily: Array<
    SalesAnalyticsDailyPoint & {
      previousGrossSalesCents: number
      previousNetSalesCents: number
      previousAovCents: number
    }
  >
}

const salesAnalyticsCache = createTtlCache<SalesAnalyticsResult>(
  ANALYTICS_CACHE_TTL_MS,
)

export const getSalesAnalytics = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      from: z.string(),
      to: z.string(),
      channel: z
        .enum(['storefront', 'admin', 'tiktok_shop', 'shopee', 'lazada'])
        .optional(),
      brand: z.string().optional(),
      comparePrevious: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }): Promise<SalesAnalyticsResult> => {
    await requireStaff()

    const cacheKey = `${data.from}|${data.to}|${data.channel ?? 'all'}|${data.brand ?? 'all'}|${data.comparePrevious}`
    const cached = salesAnalyticsCache.get(cacheKey)
    if (cached) return cached

    const admin = getSupabaseAdminClient()

    // The previous-period comparison is completely independent of the
    // current period's data, so both run concurrently instead of one after
    // the other when comparePrevious is on — halving the wall-clock time
    // for that case.
    const [current, prevResult] = await Promise.all([
      computeSalesAnalytics(admin, data.from, data.to, data.channel, data.brand),
      data.comparePrevious
        ? (() => {
            const prev = previousPeriod(data.from, data.to)
            return computeSalesAnalytics(
              admin,
              prev.from,
              prev.to,
              data.channel,
              data.brand,
            )
          })()
        : null,
    ])

    const previousTotals: SalesAnalyticsTotals | null = prevResult?.totals ?? null
    const previousDaily: SalesAnalyticsDailyPoint[] = prevResult?.daily ?? []

    const daily = current.daily.map((point, i) => ({
      ...point,
      previousGrossSalesCents: previousDaily[i]?.grossSalesCents ?? 0,
      previousNetSalesCents: previousDaily[i]?.netSalesCents ?? 0,
      previousAovCents: previousDaily[i]?.aovCents ?? 0,
    }))

    const result: SalesAnalyticsResult = {
      range: { from: data.from, to: data.to },
      totals: current.totals,
      previousTotals,
      daily,
    }
    salesAnalyticsCache.set(cacheKey, result)
    return result
  })

export interface ProductProfitRow {
  productId: string | null
  productName: string
  imageUrl: string | null
  unitsSold: number
  grossSalesCents: number
  netProfitCents: number
  marginPct: number | null
  srpCents: number | null
  costCents: number | null
  netProfitPerUnitCents: number | null
  /** Live stock on hand, summed across all of the product's variants —
   *  independent of the row's date range. Null for snapshot-name buckets
   *  (line items with no variant, e.g. a manual price adjustment). */
  currentStockOnHand: number | null
}

const productProfitCache = createTtlCache<ProductProfitRow[]>(
  ANALYTICS_CACHE_TTL_MS,
)

export const getProductProfitBreakdown = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      from: z.string(),
      to: z.string(),
      channel: z
        .enum(['storefront', 'admin', 'tiktok_shop', 'shopee', 'lazada'])
        .optional(),
      brand: z.string().optional(),
    }),
  )
  .handler(async ({ data }): Promise<ProductProfitRow[]> => {
    await requireStaff()

    const cacheKey = `${data.from}|${data.to}|${data.channel ?? 'all'}|${data.brand ?? 'all'}`
    const cached = productProfitCache.get(cacheKey)
    if (cached) return cached

    const admin = getSupabaseAdminClient()

    const { start: rangeStart, end: rangeEnd } = storeRangeToUtcBounds(
      data.from,
      data.to,
    )

    const orders = await fetchAllRows((offset) => {
      let query = admin
        .from('orders')
        .select('id, status')
        .gte('placed_at', rangeStart)
        .lte('placed_at', rangeEnd)
        .range(offset, offset + 999)
      if (data.channel) query = query.eq('source', data.channel)
      if (data.brand) query = query.eq('brand', data.brand)
      return query
    })
    const liveOrderIds = orders
      .filter((o) => !VOID_STATUSES.has(o.status))
      .map((o) => o.id)
    if (liveOrderIds.length === 0) {
      productProfitCache.set(cacheKey, [])
      return []
    }

    const itemChunks = await Promise.all(
      chunkArray(liveOrderIds, ORDER_ID_CHUNK_SIZE).map((ids) =>
        fetchAllRows((offset) =>
          admin
            .from('order_items')
            .select(
              'variant_id, product_name_snapshot, quantity, line_total_cents',
            )
            .in('order_id', ids)
            .range(offset, offset + 999),
        ),
      ),
    )
    const items = itemChunks.flat()

    const variantIds = Array.from(
      new Set(
        items.map((i) => i.variant_id).filter((v): v is string => v !== null),
      ),
    )
    const variants =
      variantIds.length > 0
        ? await fetchAllRows((offset) =>
            admin
              .from('product_variants')
              .select('id, product_id, price_cents, cost_cents')
              .in('id', variantIds)
              .range(offset, offset + 999),
          )
        : []
    const variantById = new Map(variants.map((v) => [v.id, v]))

    // order_items.variant_id is nullable (ON DELETE SET NULL — see
    // 0001_init_schema.sql:412): once a variant is deleted/replaced (e.g. a
    // size re-added during a product edit), every historical order_items row
    // that used it loses its variant_id, leaving only product_name_snapshot
    // (the product's name captured at order time) to identify it. Resolve
    // those back to the live product by name so they land in the same bucket
    // as the product's other, intact sales instead of splitting into a
    // separate "orphaned" row with no cost data. Best-effort: if two
    // different products ever shared the exact same name, this picks
    // whichever one the query happens to return first.
    const orphanNames = Array.from(
      new Set(
        items
          .filter((i) => i.variant_id === null)
          .map((i) => i.product_name_snapshot),
      ),
    )
    const productIdByOrphanName = new Map<string, string>()
    if (orphanNames.length > 0) {
      const orphanMatches = await fetchAllRows((offset) =>
        admin
          .from('products')
          .select('id, name')
          .in('name', orphanNames)
          .range(offset, offset + 999),
      )
      for (const p of orphanMatches) {
        if (!productIdByOrphanName.has(p.name)) {
          productIdByOrphanName.set(p.name, p.id)
        }
      }
    }

    const productIds = Array.from(
      new Set([
        ...variants.map((v) => v.product_id),
        ...productIdByOrphanName.values(),
      ]),
    )
    const products =
      productIds.length > 0
        ? await fetchAllRows((offset) =>
            admin
              .from('products')
              .select('id, name, images')
              .in('id', productIds)
              .range(offset, offset + 999),
          )
        : []
    const productNameById = new Map(products.map((p) => [p.id, p.name]))
    const productImageById = new Map(
      products.map((p) => [p.id, p.images[0] ?? null]),
    )

    // Current stock is a live figure, not scoped to the date range — fetched
    // across ALL of each product's variants (not just the ones sold in this
    // range), since a size that didn't sell still counts toward stock on hand.
    // Also doubles as the cost/SRP fallback for orphaned line items above —
    // their own variant's price/cost is gone, so the average across the
    // product's currently active variants is the best available estimate,
    // and a real average beats silently treating cost as ₱0 (which used to
    // inflate margin on those units to an artificial 100%).
    const stockRows =
      productIds.length > 0
        ? await fetchAllRows((offset) =>
            admin
              .from('products')
              .select(
                'id, variants:product_variants(price_cents, cost_cents, inventory(quantity_on_hand))',
              )
              .in('id', productIds)
              .range(offset, offset + 999),
          )
        : []
    const currentStockByProduct = new Map<string, number>()
    const avgCostByProduct = new Map<string, number>()
    const avgSrpByProduct = new Map<string, number>()
    for (const row of stockRows) {
      let stock = 0
      let costSum = 0
      let costCount = 0
      let srpSum = 0
      for (const variant of row.variants) {
        for (const inv of variant.inventory) stock += inv.quantity_on_hand
        // cost_cents is nullable (staff hasn't always filled it in) — only
        // average over variants that actually have one set, rather than
        // treating a missing cost as ₱0 and dragging the average down.
        if (variant.cost_cents !== null) {
          costSum += variant.cost_cents
          costCount += 1
        }
        srpSum += variant.price_cents
      }
      currentStockByProduct.set(row.id, stock)
      if (costCount > 0) {
        avgCostByProduct.set(row.id, Math.round(costSum / costCount))
      }
      if (row.variants.length > 0) {
        avgSrpByProduct.set(row.id, Math.round(srpSum / row.variants.length))
      }
    }

    interface Bucket {
      productId: string | null
      name: string
      imageUrl: string | null
      unitsSold: number
      grossSalesCents: number
      costOfGoodsCents: number
      srpCents: number | null
      costCents: number | null
    }
    const buckets = new Map<string, Bucket>()
    for (const item of items) {
      const variant = item.variant_id
        ? variantById.get(item.variant_id)
        : undefined
      // A variant-less item still resolves to its real product via the
      // name lookup above, whenever that product still exists — only a
      // renamed/fully-deleted product falls through to the snapshot-name
      // bucket below.
      const productId =
        variant?.product_id ??
        productIdByOrphanName.get(item.product_name_snapshot) ??
        null
      // Line items with no variant AND no resolvable product (e.g. a manual
      // price adjustment, or the product itself was deleted) get grouped by
      // their own snapshot name instead of a shared product.
      const key = productId ?? `snapshot:${item.product_name_snapshot}`
      // Fallback cost/SRP for a variant-less item: the average across the
      // resolved product's currently active variants, not ₱0 — a real
      // estimate instead of silently inflating this unit's margin to 100%.
      const fallbackCostCents = productId
        ? (avgCostByProduct.get(productId) ?? 0)
        : 0
      const fallbackSrpCents = productId
        ? (avgSrpByProduct.get(productId) ?? null)
        : null
      const bucket = buckets.get(key) ?? {
        productId,
        name: productId
          ? (productNameById.get(productId) ?? item.product_name_snapshot)
          : item.product_name_snapshot,
        imageUrl: productId ? (productImageById.get(productId) ?? null) : null,
        unitsSold: 0,
        grossSalesCents: 0,
        costOfGoodsCents: 0,
        srpCents: variant?.price_cents ?? fallbackSrpCents,
        costCents: variant?.cost_cents ?? (productId ? fallbackCostCents : null),
      }
      bucket.unitsSold += item.quantity
      bucket.grossSalesCents += item.line_total_cents
      bucket.costOfGoodsCents +=
        (variant?.cost_cents ?? fallbackCostCents) * item.quantity
      buckets.set(key, bucket)
    }

    const result = Array.from(buckets.values())
      .map((b) => {
        const netProfitCents = b.grossSalesCents - b.costOfGoodsCents
        return {
          productId: b.productId,
          productName: b.name,
          imageUrl: b.imageUrl,
          unitsSold: b.unitsSold,
          grossSalesCents: b.grossSalesCents,
          netProfitCents,
          marginPct:
            b.grossSalesCents > 0
              ? (netProfitCents / b.grossSalesCents) * 100
              : null,
          srpCents: b.srpCents,
          costCents: b.costCents,
          netProfitPerUnitCents:
            b.unitsSold > 0 ? Math.round(netProfitCents / b.unitsSold) : null,
          currentStockOnHand: b.productId
            ? (currentStockByProduct.get(b.productId) ?? 0)
            : null,
        }
      })
      .sort((a, b) => b.netProfitCents - a.netProfitCents)

    productProfitCache.set(cacheKey, result)
    return result
  })

const VELOCITY_LOOKBACK_DAYS = 30
const VELOCITY_WELL_STOCKED_THRESHOLD = 50
// The only movement types that ever change inventory.quantity_on_hand —
// sale_reserved/sale_released only touch quantity_reserved and would
// corrupt an on-hand reconstruction if included (see restock_variant_stock/
// commit_variant_stock/reserve_variant_stock's own comments in
// 0001_init_schema.sql for which RPC logs which type).
const STOCK_AFFECTING_MOVEMENT_TYPES = [
  'sale_committed',
  'return_in',
  'purchase_in',
  'adjustment',
] as const

export interface ProductVelocitySignal {
  productId: string
  productName: string
  imageUrl: string | null
  currentStockOnHand: number
  /** Plain average over the full trailing 30 days (fixed denominator of
   *  30) — used for cash-cow/clearance classification. */
  avgUnitsPerDay: number
  /** Average over only the days this product's aggregate on-hand stock
   *  was 50+ at the START of that day — a stockout-throttled day (e.g.
   *  one size selling out) undercounts real demand for reasons unrelated
   *  to actual demand, so it's excluded entirely rather than counted as a
   *  low day. Null when there were zero qualifying days — not enough
   *  trustworthy signal to base a restock decision on, so such a product
   *  never appears in the restock table regardless of how low its current
   *  stock is. Used only for the restock table (section 2). */
  avgUnitsPerDayWhenWellStocked: number | null
  qualifyingDayCount: number
}

const productVelocityCache = createTtlCache<ProductVelocitySignal[]>(
  ANALYTICS_CACHE_TTL_MS,
)

/**
 * Per-product 30-day sales velocity plus a reconstructed daily on-hand
 * stock history — powers the Product Analytics page's restock/cash-cow/
 * clearance sections (src/routes/admin/analytics/product-analytics.tsx).
 * There's no per-day stock snapshot table, so each product's stock level
 * at the start of each of the last 30 days is reconstructed by walking
 * inventory_movements backward from the current quantity_on_hand.
 *
 * "Units sold" (order_items.quantity), not distinct order count, is what
 * "orders per day" means throughout — a 3-unit order should weigh the same
 * as three 1-unit orders for stock-planning purposes.
 *
 * Only products with at least a full 30-day history are included (a newer
 * product can't be fairly judged against a 30-day velocity signal) — this
 * function is for restock/cash-cow/clearance decisions only, not the page's
 * separate top-sellers section (which uses getProductProfitBreakdown and
 * has its own interactive date range).
 */
export const getProductVelocitySignals = createServerFn({ method: 'GET' })
  .validator(z.object({ brand: z.enum(STOREFRONT_BRANDS).optional() }))
  .handler(async ({ data }): Promise<ProductVelocitySignal[]> => {
    await requireStaff()

    const cacheKey = data.brand ?? 'all'
    const cached = productVelocityCache.get(cacheKey)
    if (cached) return cached

    const admin = getSupabaseAdminClient()

    const today = daysAgo(0)
    const windowStartDay = daysAgo(VELOCITY_LOOKBACK_DAYS)
    const { start: windowStart, end: windowEnd } = storeRangeToUtcBounds(
      windowStartDay,
      today,
    )

    const products = await fetchAllRows((offset) => {
      let query = admin
        .from('products')
        .select(
          'id, name, images, created_at, variants:product_variants(id, inventory(quantity_on_hand))',
        )
        .eq('status', 'active')
        .lt('created_at', windowStart)
        .range(offset, offset + 999)
      if (data.brand) query = query.eq('brand', data.brand)
      return query
    })
    if (products.length === 0) {
      productVelocityCache.set(cacheKey, [])
      return []
    }

    const variantToProduct = new Map<string, string>()
    const currentStockByProduct = new Map<string, number>()
    for (const product of products) {
      let stock = 0
      for (const variant of product.variants) {
        variantToProduct.set(variant.id, product.id)
        for (const inv of variant.inventory) {
          stock += inv.quantity_on_hand
        }
      }
      currentStockByProduct.set(product.id, stock)
    }
    const variantIds = Array.from(variantToProduct.keys())

    // quantity_delta bucketed by (productId, store-local day).
    const deltaByProductAndDay = new Map<string, Map<string, number>>()
    if (variantIds.length > 0) {
      const movementChunks = await Promise.all(
        chunkArray(variantIds, ORDER_ID_CHUNK_SIZE).map((ids) =>
          fetchAllRows((offset) =>
            admin
              .from('inventory_movements')
              .select('variant_id, quantity_delta, created_at')
              .in('variant_id', ids)
              .in('movement_type', STOCK_AFFECTING_MOVEMENT_TYPES)
              .gte('created_at', windowStart)
              .range(offset, offset + 999),
          ),
        ),
      )
      for (const movement of movementChunks.flat()) {
        const productId = variantToProduct.get(movement.variant_id)
        if (!productId) continue
        const dayKey = storeLocalDateKey(movement.created_at)
        const byDay = deltaByProductAndDay.get(productId) ?? new Map()
        byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + movement.quantity_delta)
        deltaByProductAndDay.set(productId, byDay)
      }
    }

    // Units sold bucketed by (productId, store-local day) — non-void
    // orders only.
    const orders = await fetchAllRows((offset) => {
      let query = admin
        .from('orders')
        .select('id, placed_at, status')
        .gte('placed_at', windowStart)
        .lte('placed_at', windowEnd)
        .range(offset, offset + 999)
      if (data.brand) query = query.eq('brand', data.brand)
      return query
    })
    const liveOrders = orders.filter((o) => !VOID_STATUSES.has(o.status))
    const dayByOrderId = new Map(
      liveOrders.map((o) => [o.id, storeLocalDateKey(o.placed_at)]),
    )
    const liveOrderIds = liveOrders.map((o) => o.id)

    const unitsByProductAndDay = new Map<string, Map<string, number>>()
    if (liveOrderIds.length > 0) {
      const itemChunks = await Promise.all(
        chunkArray(liveOrderIds, ORDER_ID_CHUNK_SIZE).map((ids) =>
          fetchAllRows((offset) =>
            admin
              .from('order_items')
              .select('order_id, variant_id, quantity')
              .in('order_id', ids)
              .range(offset, offset + 999),
          ),
        ),
      )
      for (const item of itemChunks.flat()) {
        if (!item.variant_id) continue
        const productId = variantToProduct.get(item.variant_id)
        if (!productId) continue
        const dayKey = dayByOrderId.get(item.order_id)
        if (!dayKey) continue
        const byDay = unitsByProductAndDay.get(productId) ?? new Map()
        byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + item.quantity)
        unitsByProductAndDay.set(productId, byDay)
      }
    }

    const result: ProductVelocitySignal[] = products.map((product) => {
      const currentStockOnHand = currentStockByProduct.get(product.id) ?? 0
      const deltaByDay = deltaByProductAndDay.get(product.id)
      const unitsByDay = unitsByProductAndDay.get(product.id)

      // Walk backward from the current on-hand snapshot to the start of
      // each of the last 30 full days (yesterday through 30 days ago) —
      // today itself is excluded from the average as an incomplete day,
      // but its so-far movements still need subtracting out first to land
      // on the true start-of-today balance.
      let cursor = currentStockOnHand - (deltaByDay?.get(today) ?? 0)
      let sumAll = 0
      let sumQualifying = 0
      let qualifyingDayCount = 0
      for (let n = 1; n <= VELOCITY_LOOKBACK_DAYS; n++) {
        const dayKey = daysAgo(n)
        cursor -= deltaByDay?.get(dayKey) ?? 0
        const unitsThatDay = unitsByDay?.get(dayKey) ?? 0
        sumAll += unitsThatDay
        if (cursor >= VELOCITY_WELL_STOCKED_THRESHOLD) {
          sumQualifying += unitsThatDay
          qualifyingDayCount += 1
        }
      }

      return {
        productId: product.id,
        productName: product.name,
        imageUrl: product.images[0] ?? null,
        currentStockOnHand,
        avgUnitsPerDay: sumAll / VELOCITY_LOOKBACK_DAYS,
        avgUnitsPerDayWhenWellStocked:
          qualifyingDayCount > 0 ? sumQualifying / qualifyingDayCount : null,
        qualifyingDayCount,
      }
    })

    productVelocityCache.set(cacheKey, result)
    return result
  })

export interface OrderProfitItemRow {
  productName: string
  variantLabel: string | null
  quantity: number
  lineTotalCents: number
  costCents: number
  profitCents: number
}

export interface OrderProfitRow {
  id: string
  orderNumber: string
  customerName: string
  placedAt: string
  status: OrderStatus
  source: OrderSource
  grossSalesCents: number
  discountCents: number
  netSalesCents: number
  costCents: number
  shippingCents: number
  refundCents: number
  profitCents: number
  marginPct: number | null
  items: OrderProfitItemRow[]
}

export interface OrderProfitListResult {
  orders: OrderProfitRow[]
  total: number
}

/**
 * Per-order breakdown for the Profit page's "Store Orders and their Profit"
 * table — same Gross Sales/Cost/Shipping/Refund/Profit/Margin columns as the
 * channel/product breakdowns above, just one row per order instead of
 * aggregated. Paginated at the database level (not fetch-everything-then-
 * slice like Best Sellers) since order volume here can run into the
 * thousands and each row needs its own order_items/variant/refund lookup.
 */
export const getOrderProfitList = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      from: z.string(),
      to: z.string(),
      channel: z
        .enum(['storefront', 'admin', 'tiktok_shop', 'shopee', 'lazada'])
        .optional(),
      brand: z.string().optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
    }),
  )
  .handler(async ({ data }): Promise<OrderProfitListResult> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const { start: rangeStart, end: rangeEnd } = storeRangeToUtcBounds(
      data.from,
      data.to,
    )

    let query = admin
      .from('orders')
      .select(
        'id, order_number, customer_id, placed_at, status, source, subtotal_cents, discount_cents, shipping_cents',
        { count: 'exact' },
      )
      .gte('placed_at', rangeStart)
      .lte('placed_at', rangeEnd)
      .order('placed_at', { ascending: false })
    if (data.channel) query = query.eq('source', data.channel)
    if (data.brand) query = query.eq('brand', data.brand)

    const offset = (data.page - 1) * data.pageSize
    query = query.range(offset, offset + data.pageSize - 1)

    const { data: orders, count, error } = await query
    if (error) throw error
    if (orders.length === 0) return { orders: [], total: count ?? 0 }

    const orderIds = orders.map((o) => o.id)
    const customerIds = Array.from(new Set(orders.map((o) => o.customer_id)))

    const [customersRes, itemsRes, returnsRes] = await Promise.all([
      admin
        .from('customers')
        .select('id, full_name, email')
        .in('id', customerIds),
      admin
        .from('order_items')
        .select(
          'order_id, variant_id, quantity, product_name_snapshot, variant_label_snapshot, line_total_cents',
        )
        .in('order_id', orderIds),
      admin
        .from('returns')
        .select('order_id, refund_amount_cents')
        .eq('status', 'refunded')
        .in('order_id', orderIds),
    ])
    if (customersRes.error) throw customersRes.error
    if (itemsRes.error) throw itemsRes.error
    if (returnsRes.error) throw returnsRes.error

    const customerById = new Map(customersRes.data.map((c) => [c.id, c]))

    const refundByOrderId = new Map<string, number>()
    for (const ret of returnsRes.data) {
      const current = refundByOrderId.get(ret.order_id) ?? 0
      refundByOrderId.set(
        ret.order_id,
        current + (ret.refund_amount_cents ?? 0),
      )
    }

    const variantIds = Array.from(
      new Set(
        itemsRes.data
          .map((i) => i.variant_id)
          .filter((v): v is string => v !== null),
      ),
    )
    const variants =
      variantIds.length > 0
        ? await fetchAllRows((rangeOffset) =>
            admin
              .from('product_variants')
              .select('id, cost_cents')
              .in('id', variantIds)
              .range(rangeOffset, rangeOffset + 999),
          )
        : []
    const costByVariantId = new Map(variants.map((v) => [v.id, v.cost_cents]))

    const cogsByOrderId = new Map<string, number>()
    for (const item of itemsRes.data) {
      const cost = item.variant_id
        ? (costByVariantId.get(item.variant_id) ?? 0)
        : 0
      const current = cogsByOrderId.get(item.order_id) ?? 0
      cogsByOrderId.set(item.order_id, current + cost * item.quantity)
    }

    const itemsByOrderId = new Map<string, OrderProfitItemRow[]>()
    for (const item of itemsRes.data) {
      const cost = item.variant_id
        ? (costByVariantId.get(item.variant_id) ?? 0) * item.quantity
        : 0
      const list = itemsByOrderId.get(item.order_id) ?? []
      list.push({
        productName: item.product_name_snapshot,
        variantLabel: item.variant_label_snapshot,
        quantity: item.quantity,
        lineTotalCents: item.line_total_cents,
        costCents: cost,
        profitCents: item.line_total_cents - cost,
      })
      itemsByOrderId.set(item.order_id, list)
    }

    const rows: OrderProfitRow[] = orders.map((order) => {
      const isVoid = VOID_STATUSES.has(order.status)
      const customer = customerById.get(order.customer_id)
      const refundCents = refundByOrderId.get(order.id) ?? 0
      const items = itemsByOrderId.get(order.id) ?? []

      if (isVoid) {
        return {
          id: order.id,
          orderNumber: order.order_number,
          customerName: customer?.full_name ?? customer?.email ?? 'Guest',
          placedAt: order.placed_at,
          status: order.status,
          source: order.source,
          grossSalesCents: 0,
          discountCents: 0,
          netSalesCents: 0,
          costCents: 0,
          shippingCents: order.shipping_cents,
          refundCents,
          profitCents: 0,
          marginPct: null,
          items,
        }
      }

      const grossSalesCents = grossSalesCentsForOrder(order)
      const netSalesCents = grossSalesCents - order.discount_cents - refundCents
      const costCents = cogsByOrderId.get(order.id) ?? 0
      const profitCents = netSalesCents - costCents

      return {
        id: order.id,
        orderNumber: order.order_number,
        customerName: customer?.full_name ?? customer?.email ?? 'Guest',
        placedAt: order.placed_at,
        status: order.status,
        source: order.source,
        grossSalesCents,
        discountCents: order.discount_cents,
        netSalesCents,
        costCents,
        shippingCents: order.shipping_cents,
        refundCents,
        profitCents,
        marginPct:
          grossSalesCents > 0 ? (profitCents / grossSalesCents) * 100 : null,
        items,
      }
    })

    return { orders: rows, total: count ?? 0 }
  })

export interface LocationSalesRow {
  city: string
  province: string | null
  orderCount: number
  grossSalesCents: number
}

const locationSalesCache = createTtlCache<LocationSalesRow[]>(
  ANALYTICS_CACHE_TTL_MS,
)

export const getSalesByLocation = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      from: z.string(),
      to: z.string(),
      channel: z
        .enum(['storefront', 'admin', 'tiktok_shop', 'shopee', 'lazada'])
        .optional(),
      brand: z.string().optional(),
    }),
  )
  .handler(async ({ data }): Promise<LocationSalesRow[]> => {
    await requireStaff()

    const cacheKey = `${data.from}|${data.to}|${data.channel ?? 'all'}|${data.brand ?? 'all'}`
    const cached = locationSalesCache.get(cacheKey)
    if (cached) return cached

    const admin = getSupabaseAdminClient()
    const { start: rangeStart, end: rangeEnd } = storeRangeToUtcBounds(
      data.from,
      data.to,
    )

    const orders = await fetchAllRows((offset) => {
      let query = admin
        .from('orders')
        .select(
          'status, source, subtotal_cents, shipping_cents, shipping_address',
        )
        .gte('placed_at', rangeStart)
        .lte('placed_at', rangeEnd)
        .range(offset, offset + 999)
      if (data.channel) query = query.eq('source', data.channel)
      if (data.brand) query = query.eq('brand', data.brand)
      return query
    })
    const liveOrders = orders.filter((o) => !VOID_STATUSES.has(o.status))

    // TikTok Shop's API doesn't expose buyer city/province to sellers (comes
    // back as empty strings) — only Online Store orders reliably carry this.
    // Skipping unidentified addresses rather than lumping them into a fake
    // "Unknown" location that would otherwise dominate the ranking.
    const buckets = new Map<
      string,
      {
        city: string
        province: string | null
        orderCount: number
        grossSalesCents: number
      }
    >()
    for (const order of liveOrders) {
      const address = order.shipping_address
      const city = typeof address.city === 'string' ? address.city.trim() : ''
      if (!city) continue
      const rawProvince =
        typeof address.province === 'string' ? address.province.trim() : ''
      const province = rawProvince || null
      const key = `${city}|${province ?? ''}`
      const bucket = buckets.get(key) ?? {
        city,
        province,
        orderCount: 0,
        grossSalesCents: 0,
      }
      bucket.orderCount += 1
      bucket.grossSalesCents += grossSalesCentsForOrder(order)
      buckets.set(key, bucket)
    }

    const result = Array.from(buckets.values()).sort(
      (a, b) => b.grossSalesCents - a.grossSalesCents,
    )
    locationSalesCache.set(cacheKey, result)
    return result
  })

export interface VisitorCountryRow {
  /** ISO country code (e.g. "SG"), null for visits with no geo header
   *  (always the case in local dev; rare in production). */
  country: string | null
  countryName: string
  uniqueVisitors: number
  pageViews: number
}

export interface VisitorCityRow {
  city: string
  /** Vercel's city header can arrive without a country in rare cases —
   *  kept nullable rather than assumed present, same as VisitorCountryRow. */
  country: string | null
  countryName: string
  uniqueVisitors: number
  pageViews: number
}

export interface VisitorAnalytics {
  uniqueVisitors: number
  pageViews: number
  previousUniqueVisitors: number
  previousPageViews: number
  countries: VisitorCountryRow[]
  /** City-level breakdown — visits with no detected city are skipped
   *  rather than lumped into a fake "Unknown" city (city detection is
   *  less reliable than country, so that bucket would dominate and add
   *  little), same precedent as getSalesByLocation's city skip above. */
  cities: VisitorCityRow[]
}

const visitorAnalyticsCache = createTtlCache<VisitorAnalytics>(
  ANALYTICS_CACHE_TTL_MS,
)

const countryDisplayNames = new Intl.DisplayNames(['en'], { type: 'region' })

function countryName(code: string | null): string {
  if (!code) return 'Unknown'
  try {
    return countryDisplayNames.of(code) ?? code
  } catch {
    return code
  }
}

/**
 * Online Store traffic only, by construction — storefront_visits is only
 * ever written by the storefront's own page loads (see
 * server/analytics/track.ts); Shopee/TikTok/Lazada shoppers never load our
 * pages, so no channel filter is needed here the way sales analytics needs
 * one.
 */
export const getVisitorAnalytics = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      from: z.string(),
      to: z.string(),
      brand: z.string().optional(),
    }),
  )
  .handler(async ({ data }): Promise<VisitorAnalytics> => {
    await requireStaff()

    const cacheKey = `${data.from}|${data.to}|${data.brand ?? 'all'}`
    const cached = visitorAnalyticsCache.get(cacheKey)
    if (cached) return cached

    const admin = getSupabaseAdminClient()
    const { start: rangeStart, end: rangeEnd } = storeRangeToUtcBounds(
      data.from,
      data.to,
    )
    const prev = previousPeriod(data.from, data.to)
    const { start: prevStart, end: prevEnd } = storeRangeToUtcBounds(
      prev.from,
      prev.to,
    )

    const [currentVisits, previousVisits] = await Promise.all([
      fetchAllRows((offset) => {
        let query = admin
          .from('storefront_visits')
          .select('visitor_id, country, city')
          .eq('event_type', 'page_view')
          .gte('created_at', rangeStart)
          .lte('created_at', rangeEnd)
          .range(offset, offset + 999)
        if (data.brand) query = query.eq('brand', data.brand)
        return query
      }),
      fetchAllRows((offset) => {
        let query = admin
          .from('storefront_visits')
          .select('visitor_id')
          .eq('event_type', 'page_view')
          .gte('created_at', prevStart)
          .lte('created_at', prevEnd)
          .range(offset, offset + 999)
        if (data.brand) query = query.eq('brand', data.brand)
        return query
      }),
    ])

    const countryBuckets = new Map<
      string,
      { visitorIds: Set<string>; pageViews: number }
    >()
    const cityBuckets = new Map<
      string,
      { city: string; country: string | null; visitorIds: Set<string>; pageViews: number }
    >()
    for (const visit of currentVisits) {
      const countryKey = visit.country ?? 'UNKNOWN'
      const countryBucket = countryBuckets.get(countryKey) ?? {
        visitorIds: new Set<string>(),
        pageViews: 0,
      }
      countryBucket.visitorIds.add(visit.visitor_id)
      countryBucket.pageViews += 1
      countryBuckets.set(countryKey, countryBucket)

      const city = visit.city?.trim()
      if (city) {
        const cityKey = `${city}|${visit.country ?? ''}`
        const cityBucket = cityBuckets.get(cityKey) ?? {
          city,
          country: visit.country,
          visitorIds: new Set<string>(),
          pageViews: 0,
        }
        cityBucket.visitorIds.add(visit.visitor_id)
        cityBucket.pageViews += 1
        cityBuckets.set(cityKey, cityBucket)
      }
    }

    const countries: VisitorCountryRow[] = Array.from(countryBuckets.entries())
      .map(([key, bucket]) => {
        const country = key === 'UNKNOWN' ? null : key
        return {
          country,
          countryName: countryName(country),
          uniqueVisitors: bucket.visitorIds.size,
          pageViews: bucket.pageViews,
        }
      })
      .sort((a, b) => b.uniqueVisitors - a.uniqueVisitors)

    const cities: VisitorCityRow[] = Array.from(cityBuckets.values())
      .map((bucket) => ({
        city: bucket.city,
        country: bucket.country,
        countryName: countryName(bucket.country),
        uniqueVisitors: bucket.visitorIds.size,
        pageViews: bucket.pageViews,
      }))
      .sort((a, b) => b.uniqueVisitors - a.uniqueVisitors)

    const result: VisitorAnalytics = {
      uniqueVisitors: new Set(currentVisits.map((v) => v.visitor_id)).size,
      pageViews: currentVisits.length,
      previousUniqueVisitors: new Set(previousVisits.map((v) => v.visitor_id))
        .size,
      previousPageViews: previousVisits.length,
      countries,
      cities,
    }
    visitorAnalyticsCache.set(cacheKey, result)
    return result
  })

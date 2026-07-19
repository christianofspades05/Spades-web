import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import {
  previousPeriod,
  storeLocalDateKey,
  storeLocalHourKey,
  storeRangeToUtcBounds,
} from '#/lib/utils/date-range'
import { chunkArray, fetchAllRows } from '#/lib/utils/paginate'
import { createTtlCache } from '#/lib/utils/cache'
import type { OrderCancellationReason, OrderSource } from '#/types/entities'

const VOID_STATUSES = new Set(['cancelled', 'failed'])
const ORDER_ID_CHUNK_SIZE = 200
const ANALYTICS_CACHE_TTL_MS = 2 * 60_000

export interface ChannelSales {
  source: OrderSource
  grossSalesCents: number
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
): Promise<{
  channels: ChannelSales[]
  totals: ChannelSales
  daily: ProfitDailyPoint[]
}> {
  const { start: rangeStart, end: rangeEnd } = storeRangeToUtcBounds(from, to)

  const orders = await fetchAllRows((offset) => {
    let orderQuery = admin
      .from('orders')
      .select('id, source, total_cents, status, placed_at')
      .gte('placed_at', rangeStart)
      .lte('placed_at', rangeEnd)
      .range(offset, offset + 999)
    if (channelFilter) orderQuery = orderQuery.eq('source', channelFilter)
    return orderQuery
  })

  const liveOrders = orders.filter((o) => !VOID_STATUSES.has(o.status))
  const orderIds = liveOrders.map((o) => o.id)

  // A marketplace return (buyer-initiated, tracked in `returns` rather than
  // by flipping the order's own status — see sync-engine.ts's comment on
  // why full-order status isn't used, since a return can be partial) still
  // shows the order's original total_cents unless the refunded amount is
  // subtracted back out here.
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

  // order_items outnumbers orders (most orders have multiple line items),
  // so this table crosses the 1000-row cap before orders itself does — the
  // select's own row cap is the risk within each chunk, which is why this
  // still wraps every chunk in fetchAllRows. The chunking itself guards
  // against a different limit: a wide date range can produce enough order
  // ids that a single .in('order_id', orderIds) query string gets rejected
  // outright (same failure mode fixed on the customers page).
  const itemChunks = await Promise.all(
    chunkArray(orderIds, ORDER_ID_CHUNK_SIZE).map((ids) =>
      fetchAllRows((offset) =>
        admin
          .from('order_items')
          .select('order_id, variant_id, quantity')
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
    { grossSalesCents: number; costOfGoodsCents: number; orderCount: number }
  >()
  for (const order of liveOrders) {
    const bucket = bySource.get(order.source) ?? {
      grossSalesCents: 0,
      costOfGoodsCents: 0,
      orderCount: 0,
    }
    const netOfRefund =
      order.total_cents - (refundByOrderId.get(order.id) ?? 0)
    bucket.grossSalesCents += netOfRefund
    bucket.costOfGoodsCents += cogsByOrderId.get(order.id) ?? 0
    bucket.orderCount += 1
    bySource.set(order.source, bucket)
  }

  const channels: ChannelSales[] = Array.from(bySource.entries())
    .map(([source, b]) => {
      const netProfitCents = b.grossSalesCents - b.costOfGoodsCents
      return {
        source,
        grossSalesCents: b.grossSalesCents,
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
      costOfGoodsCents: sum.costOfGoodsCents + c.costOfGoodsCents,
      orderCount: sum.orderCount + c.orderCount,
    }),
    { grossSalesCents: 0, costOfGoodsCents: 0, orderCount: 0 },
  )
  const totalNetProfitCents =
    totalsRaw.grossSalesCents - totalsRaw.costOfGoodsCents
  const totals: ChannelSales = {
    source: 'storefront',
    grossSalesCents: totalsRaw.grossSalesCents,
    costOfGoodsCents: totalsRaw.costOfGoodsCents,
    netProfitCents: totalNetProfitCents,
    marginPct:
      totalsRaw.grossSalesCents > 0
        ? (totalNetProfitCents / totalsRaw.grossSalesCents) * 100
        : null,
    orderCount: totalsRaw.orderCount,
  }

  // Bucketed by day so days with zero orders still show up as a zero point
  // rather than being missing from the chart entirely.
  const dailyMap = new Map<
    string,
    { grossSalesCents: number; costOfGoodsCents: number }
  >()
  for (
    const d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    dailyMap.set(d.toISOString().slice(0, 10), {
      grossSalesCents: 0,
      costOfGoodsCents: 0,
    })
  }
  for (const order of liveOrders) {
    const key = storeLocalDateKey(order.placed_at)
    const bucket = dailyMap.get(key)
    if (!bucket) continue
    bucket.grossSalesCents +=
      order.total_cents - (refundByOrderId.get(order.id) ?? 0)
    bucket.costOfGoodsCents += cogsByOrderId.get(order.id) ?? 0
  }
  const daily: ProfitDailyPoint[] = Array.from(dailyMap.entries()).map(
    ([date, b]) => {
      const netProfitCents = b.grossSalesCents - b.costOfGoodsCents
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
  /** Online Store "Failed Delivery" cancellations combined with TikTok/
   *  Shopee returns — different mechanisms recording the same underlying
   *  event (a parcel that came back instead of reaching the buyer). */
  failedDeliveryOrReturn: {
    total: number
    failedDeliveryCount: number
    marketplaceReturnsCount: number
  }
  daily: { date: string; count: number }[]
  byReason: { reason: OrderCancellationReason | 'unspecified'; count: number }[]
  byChannel: { source: OrderSource; count: number }[]
  /** Same reason breakdown as byReason, but scoped to one channel at a time
   *  — powers the per-channel "cancellation reason" sections on the admin
   *  page, since byReason/byChannel alone can't answer "why is TikTok
   *  cancelling orders" on their own. */
  byChannelAndReason: {
    source: OrderSource
    total: number
    byReason: { reason: OrderCancellationReason | 'unspecified'; count: number }[]
  }[]
  returns: {
    totalCount: number
    totalRefundCents: number
    byChannel: { source: OrderSource; count: number }[]
  }
}

export const getCancelledAndReturns = createServerFn({ method: 'GET' })
  .validator(z.object({ from: z.string(), to: z.string() }))
  .handler(async ({ data }): Promise<CancelledReturnsResult> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const { start: rangeStart, end: rangeEnd } = storeRangeToUtcBounds(
      data.from,
      data.to,
    )

    const cancelledOrders = await fetchAllRows((offset) =>
      admin
        .from('orders')
        .select('id, source, cancellation_reason, cancelled_at')
        .eq('status', 'cancelled')
        .gte('cancelled_at', rangeStart)
        .lte('cancelled_at', rangeEnd)
        .range(offset, offset + 999),
    )

    // A single-day range (e.g. "Today") gets bucketed by hour instead of by
    // day — see the same treatment in dashboard.ts's getDashboardAnalytics.
    const isSingleDay = data.from === data.to
    const bucketKey = (iso: string) =>
      isSingleDay ? storeLocalHourKey(iso) : storeLocalDateKey(iso)

    const dailyMap = new Map<string, number>()
    if (isSingleDay) {
      for (let hour = 0; hour < 24; hour++) {
        dailyMap.set(`${data.from}T${String(hour).padStart(2, '0')}`, 0)
      }
    } else {
      for (
        const d = new Date(`${data.from}T00:00:00Z`);
        d <= new Date(`${data.to}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1)
      ) {
        dailyMap.set(d.toISOString().slice(0, 10), 0)
      }
    }
    const byReasonMap = new Map<
      OrderCancellationReason | 'unspecified',
      number
    >()
    const byChannelMap = new Map<OrderSource, number>()
    const byChannelAndReasonMap = new Map<
      OrderSource,
      Map<OrderCancellationReason | 'unspecified', number>
    >()

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
    }

    const returns = await fetchAllRows((offset) =>
      admin
        .from('returns')
        .select('id, order_id, refund_amount_cents, requested_at')
        .gte('requested_at', rangeStart)
        .lte('requested_at', rangeEnd)
        .range(offset, offset + 999),
    )

    const returnOrderIds = Array.from(new Set(returns.map((r) => r.order_id)))
    const returnOrders =
      returnOrderIds.length > 0
        ? await fetchAllRows((offset) =>
            admin
              .from('orders')
              .select('id, source')
              .in('id', returnOrderIds)
              .range(offset, offset + 999),
          )
        : []
    const sourceByOrderId = new Map(returnOrders.map((o) => [o.id, o.source]))

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

    return {
      range: { from: data.from, to: data.to },
      totalCancelled: cancelledOrders.length,
      failedDeliveryOrReturn: {
        total: failedDeliveryCount + marketplaceReturnsCount,
        failedDeliveryCount,
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
    }
  })

export const getSalesByChannel = createServerFn({ method: 'GET' })
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
  .handler(async ({ data }): Promise<SalesByChannelResult> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const current = await computeChannelSales(
      admin,
      data.from,
      data.to,
      data.channel,
    )

    let previous: SalesByChannelResult['previous'] = null
    if (data.comparePrevious) {
      const prev = previousPeriod(data.from, data.to)
      const prevResult = await computeChannelSales(
        admin,
        prev.from,
        prev.to,
        data.channel,
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

export interface SalesAnalyticsTotals {
  grossSalesCents: number
  discountsCents: number
  refundsCents: number
  netSalesCents: number
  orderCount: number
  aovCents: number
}

export interface SalesAnalyticsDailyPoint {
  date: string
  grossSalesCents: number
  netSalesCents: number
  orderCount: number
  aovCents: number
}

/**
 * Unlike computeChannelSales (which uses total_cents — already post-discount
 * — as "gross sales" for the Profit page's COGS-driven margin math), this
 * reconstructs the true pre-discount gross sales as subtotal_cents +
 * shipping_cents, so Discounts can be broken out as its own line matching
 * what a Sales Analytics breakdown is expected to show. netSalesCents ends
 * up equal to total_cents minus any refund, same number either way.
 */
async function computeSalesAnalytics(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  from: string,
  to: string,
  channelFilter: OrderSource | undefined,
): Promise<{
  totals: SalesAnalyticsTotals
  daily: SalesAnalyticsDailyPoint[]
}> {
  const { start: rangeStart, end: rangeEnd } = storeRangeToUtcBounds(from, to)

  const orders = await fetchAllRows((offset) => {
    let query = admin
      .from('orders')
      .select(
        'id, status, placed_at, subtotal_cents, discount_cents, shipping_cents, total_cents',
      )
      .gte('placed_at', rangeStart)
      .lte('placed_at', rangeEnd)
      .range(offset, offset + 999)
    if (channelFilter) query = query.eq('source', channelFilter)
    return query
  })

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

  let grossSalesCents = 0
  let discountsCents = 0
  let refundsCents = 0
  for (const order of liveOrders) {
    grossSalesCents += order.subtotal_cents + order.shipping_cents
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
    bucket.grossSalesCents += order.subtotal_cents + order.shipping_cents
    bucket.netSalesCents +=
      order.total_cents - (refundByOrderId.get(order.id) ?? 0)
    bucket.orderCount += 1
  }
  const daily: SalesAnalyticsDailyPoint[] = Array.from(
    dailyMap.entries(),
  ).map(([date, b]) => ({
    date,
    grossSalesCents: b.grossSalesCents,
    netSalesCents: b.netSalesCents,
    orderCount: b.orderCount,
    aovCents: b.orderCount > 0 ? Math.round(b.netSalesCents / b.orderCount) : 0,
  }))

  return {
    totals: {
      grossSalesCents,
      discountsCents,
      refundsCents,
      netSalesCents,
      orderCount,
      aovCents,
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
      comparePrevious: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }): Promise<SalesAnalyticsResult> => {
    await requireStaff()

    const cacheKey = `${data.from}|${data.to}|${data.channel ?? 'all'}|${data.comparePrevious}`
    const cached = salesAnalyticsCache.get(cacheKey)
    if (cached) return cached

    const admin = getSupabaseAdminClient()

    const current = await computeSalesAnalytics(
      admin,
      data.from,
      data.to,
      data.channel,
    )

    let previousTotals: SalesAnalyticsTotals | null = null
    let previousDaily: SalesAnalyticsDailyPoint[] = []
    if (data.comparePrevious) {
      const prev = previousPeriod(data.from, data.to)
      const prevResult = await computeSalesAnalytics(
        admin,
        prev.from,
        prev.to,
        data.channel,
      )
      previousTotals = prevResult.totals
      previousDaily = prevResult.daily
    }

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
    }),
  )
  .handler(async ({ data }): Promise<ProductProfitRow[]> => {
    await requireStaff()

    const cacheKey = `${data.from}|${data.to}|${data.channel ?? 'all'}`
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
            .select('variant_id, product_name_snapshot, quantity, line_total_cents')
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

    const productIds = Array.from(new Set(variants.map((v) => v.product_id)))
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
      const variant = item.variant_id ? variantById.get(item.variant_id) : undefined
      const productId = variant?.product_id ?? null
      // Line items with no variant (e.g. a manual price adjustment) get
      // grouped by their own snapshot name instead of a shared product.
      const key = productId ?? `snapshot:${item.product_name_snapshot}`
      const bucket = buckets.get(key) ?? {
        productId,
        name: productId
          ? (productNameById.get(productId) ?? item.product_name_snapshot)
          : item.product_name_snapshot,
        imageUrl: productId ? (productImageById.get(productId) ?? null) : null,
        unitsSold: 0,
        grossSalesCents: 0,
        costOfGoodsCents: 0,
        srpCents: variant?.price_cents ?? null,
        costCents: variant?.cost_cents ?? null,
      }
      bucket.unitsSold += item.quantity
      bucket.grossSalesCents += item.line_total_cents
      bucket.costOfGoodsCents += (variant?.cost_cents ?? 0) * item.quantity
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
        }
      })
      .sort((a, b) => b.netProfitCents - a.netProfitCents)

    productProfitCache.set(cacheKey, result)
    return result
  })

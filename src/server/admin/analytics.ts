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
import type { OrderCancellationReason, OrderSource } from '#/types/entities'

const VOID_STATUSES = new Set(['cancelled', 'failed'])

export interface ChannelSales {
  source: OrderSource
  grossSalesCents: number
  costOfGoodsCents: number
  netProfitCents: number
  marginPct: number | null
  orderCount: number
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
  previous: {
    channels: ChannelSales[]
    totals: {
      grossSalesCents: number
      costOfGoodsCents: number
      netProfitCents: number
      marginPct: number | null
      orderCount: number
    }
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
): Promise<{ channels: ChannelSales[]; totals: ChannelSales }> {
  const { start: rangeStart, end: rangeEnd } = storeRangeToUtcBounds(from, to)

  let orderQuery = admin
    .from('orders')
    .select('id, source, total_cents, status')
    .gte('placed_at', rangeStart)
    .lte('placed_at', rangeEnd)
  if (channelFilter) orderQuery = orderQuery.eq('source', channelFilter)
  const { data: orders, error: ordersError } = await orderQuery
  if (ordersError) throw ordersError

  const liveOrders = orders.filter((o) => !VOID_STATUSES.has(o.status))
  const orderIds = liveOrders.map((o) => o.id)

  const { data: items, error: itemsError } =
    orderIds.length > 0
      ? await admin
          .from('order_items')
          .select('order_id, variant_id, quantity')
          .in('order_id', orderIds)
      : { data: [], error: null }
  if (itemsError) throw itemsError

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
    bucket.grossSalesCents += order.total_cents
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

  return { channels, totals }
}

export interface CancelledReturnsResult {
  range: { from: string; to: string }
  totalCancelled: number
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

    const { data: cancelledOrders, error: cancelledError } = await admin
      .from('orders')
      .select('id, source, cancellation_reason, cancelled_at')
      .eq('status', 'cancelled')
      .gte('cancelled_at', rangeStart)
      .lte('cancelled_at', rangeEnd)
    if (cancelledError) throw cancelledError

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

    const { data: returns, error: returnsError } = await admin
      .from('returns')
      .select('id, order_id, refund_amount_cents, requested_at')
      .gte('requested_at', rangeStart)
      .lte('requested_at', rangeEnd)
    if (returnsError) throw returnsError

    const returnOrderIds = Array.from(new Set(returns.map((r) => r.order_id)))
    const { data: returnOrders, error: returnOrdersError } =
      returnOrderIds.length > 0
        ? await admin
            .from('orders')
            .select('id, source')
            .in('id', returnOrderIds)
        : { data: [], error: null }
    if (returnOrdersError) throw returnOrdersError
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

    return {
      range: { from: data.from, to: data.to },
      totalCancelled: cancelledOrders.length,
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
      previous = { channels: prevResult.channels, totals: prevResult.totals }
    }

    return {
      range: { from: data.from, to: data.to },
      channels: current.channels,
      totals: current.totals,
      previous,
    }
  })

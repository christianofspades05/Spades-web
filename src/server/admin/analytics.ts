import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type { OrderSource } from '#/types/entities'

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
  const rangeStart = `${from}T00:00:00.000Z`
  const rangeEnd = `${to}T23:59:59.999Z`

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
      const fromDate = new Date(`${data.from}T00:00:00`)
      const toDate = new Date(`${data.to}T00:00:00`)
      const lengthDays =
        Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1
      const prevTo = new Date(fromDate)
      prevTo.setDate(prevTo.getDate() - 1)
      const prevFrom = new Date(prevTo)
      prevFrom.setDate(prevFrom.getDate() - (lengthDays - 1))

      const prevResult = await computeChannelSales(
        admin,
        prevFrom.toISOString().slice(0, 10),
        prevTo.toISOString().slice(0, 10),
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

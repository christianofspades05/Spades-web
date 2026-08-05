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
import { fetchAllRows } from '#/lib/utils/paginate'

const VOID_STATUSES = new Set(['cancelled', 'failed'])

interface BucketPoint {
  label: string
  orders: number
  salesCents: number
  visitors: number
  storefrontOrders: number
}

/**
 * Buckets one period's orders/visits by hour (single-day range) or by day
 * (anything wider) — shared between the current and previous period so the
 * dashboard's comparison overlay lines up bucket-for-bucket (e.g. "this hour
 * today" against "the same hour yesterday").
 */
function bucketPeriod(
  fromDate: string,
  toDate: string,
  isSingleDay: boolean,
  orders: {
    placed_at: string
    total_cents: number
    status: string
    source: string
  }[],
  visits: { visitor_id: string; created_at: string }[],
  // Narrows orders/salesCents to one channel (see getDashboardAnalytics's
  // `channel` param) — storefrontOrders stays unfiltered by this: it's
  // already its own deliberately storefront-only figure for conversion
  // rate, unrelated to which channel the merchant is browsing sales for.
  channel?: string,
): BucketPoint[] {
  const bucketKeyOf = (iso: string) =>
    isSingleDay ? storeLocalHourKey(iso) : storeLocalDateKey(iso)

  const keys: string[] = []
  const labels: string[] = []
  if (isSingleDay) {
    for (let hour = 0; hour < 24; hour++) {
      const hh = String(hour).padStart(2, '0')
      keys.push(`${fromDate}T${hh}`)
      labels.push(
        new Date(`${fromDate}T${hh}:00:00`).toLocaleTimeString('en-US', {
          hour: 'numeric',
        }),
      )
    }
  } else {
    for (
      const d = new Date(`${fromDate}T00:00:00Z`);
      d <= new Date(`${toDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1)
    ) {
      const key = d.toISOString().slice(0, 10)
      keys.push(key)
      labels.push(key)
    }
  }

  const indexByKey = new Map(keys.map((key, i) => [key, i]))
  const points: BucketPoint[] = keys.map((_, i) => ({
    label: labels[i],
    orders: 0,
    salesCents: 0,
    visitors: 0,
    storefrontOrders: 0,
  }))
  const visitorSets = points.map(() => new Set<string>())

  for (const order of orders) {
    const idx = indexByKey.get(bucketKeyOf(order.placed_at))
    if (idx === undefined) continue
    const point = points[idx]
    const isVoid = VOID_STATUSES.has(order.status)
    if (!isVoid) {
      if (!channel || order.source === channel) {
        point.orders += 1
        point.salesCents += order.total_cents
      }
      if (order.source === 'storefront') point.storefrontOrders += 1
    }
  }

  for (const visit of visits) {
    const idx = indexByKey.get(bucketKeyOf(visit.created_at))
    if (idx === undefined) continue
    visitorSets[idx].add(visit.visitor_id)
  }
  points.forEach((point, i) => {
    point.visitors = visitorSets[i].size
  })

  return points
}

export interface DailyPoint {
  date: string
  orders: number
  salesCents: number
  visitors: number
  conversionRate: number | null
  /** salesCents / orders for this bucket, rounded to the nearest cent — null
   *  once orders is 0, same "nothing to divide by" convention
   *  conversionRate already uses. */
  aovCents: number | null
  previousOrders: number
  previousSalesCents: number
  previousVisitors: number
  previousConversionRate: number | null
  previousAovCents: number | null
}

export interface DashboardAnalytics {
  range: { from: string; to: string }
  sales: { cents: number; previousCents: number }
  orders: { count: number; previousCount: number }
  visitors: { count: number; previousCount: number }
  conversionRate: { rate: number | null; previousRate: number | null }
  /** Average order value — sales.cents / orders.count over the whole
   *  selected range, not a per-bucket average of the daily figures (which
   *  would over-weight low-order days). Null once orders.count is 0. */
  averageOrderValue: { cents: number | null; previousCents: number | null }
  daily: DailyPoint[]
}

export const getDashboardAnalytics = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      from: z.string(),
      to: z.string(),
      brand: z.string().optional(),
      channel: z.string().optional(),
    }),
  )
  .handler(async ({ data }): Promise<DashboardAnalytics> => {
    await requireStaff()
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

    const [currentOrders, previousOrders, currentVisits, previousVisits] =
      await Promise.all([
        fetchAllRows((offset) => {
          let query = admin
            .from('orders')
            .select('placed_at, total_cents, status, source')
            .gte('placed_at', rangeStart)
            .lte('placed_at', rangeEnd)
            .range(offset, offset + 999)
          if (data.brand) query = query.eq('brand', data.brand)
          return query
        }),
        fetchAllRows((offset) => {
          let query = admin
            .from('orders')
            .select('placed_at, total_cents, status, source')
            .gte('placed_at', prevStart)
            .lte('placed_at', prevEnd)
            .range(offset, offset + 999)
          if (data.brand) query = query.eq('brand', data.brand)
          return query
        }),
        fetchAllRows((offset) => {
          let query = admin
            .from('storefront_visits')
            .select('visitor_id, created_at')
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
            .select('visitor_id, created_at')
            .eq('event_type', 'page_view')
            .gte('created_at', prevStart)
            .lte('created_at', prevEnd)
            .range(offset, offset + 999)
          if (data.brand) query = query.eq('brand', data.brand)
          return query
        }),
      ])

    // A single-day range (e.g. "Today") gets bucketed by hour instead of by
    // day — one data point for the whole day would be a flat, useless
    // chart. Anything wider stays bucketed by day, same as before.
    const isSingleDay = data.from === data.to

    const currentBuckets = bucketPeriod(
      data.from,
      data.to,
      isSingleDay,
      currentOrders,
      currentVisits,
      data.channel,
    )
    const previousBuckets = bucketPeriod(
      prev.from,
      prev.to,
      isSingleDay,
      previousOrders,
      previousVisits,
      data.channel,
    )

    const daily: DailyPoint[] = currentBuckets.map((point, i) => {
      const prevPoint = previousBuckets.at(i)
      return {
        date: point.label,
        orders: point.orders,
        salesCents: point.salesCents,
        visitors: point.visitors,
        conversionRate:
          point.visitors > 0
            ? (point.storefrontOrders / point.visitors) * 100
            : null,
        aovCents:
          point.orders > 0 ? Math.round(point.salesCents / point.orders) : null,
        previousOrders: prevPoint?.orders ?? 0,
        previousSalesCents: prevPoint?.salesCents ?? 0,
        previousVisitors: prevPoint?.visitors ?? 0,
        previousConversionRate:
          prevPoint && prevPoint.visitors > 0
            ? (prevPoint.storefrontOrders / prevPoint.visitors) * 100
            : null,
        previousAovCents:
          prevPoint && prevPoint.orders > 0
            ? Math.round(prevPoint.salesCents / prevPoint.orders)
            : null,
      }
    })

    const matchesChannel = (source: string) =>
      !data.channel || source === data.channel

    let salesCents = 0
    for (const order of currentOrders) {
      if (!VOID_STATUSES.has(order.status) && matchesChannel(order.source)) {
        salesCents += order.total_cents
      }
    }

    const previousSalesCents = previousOrders
      .filter((o) => !VOID_STATUSES.has(o.status) && matchesChannel(o.source))
      .reduce((sum, o) => sum + o.total_cents, 0)

    const uniqueVisitors = new Set(currentVisits.map((v) => v.visitor_id))
    const previousUniqueVisitors = new Set(
      previousVisits.map((v) => v.visitor_id),
    )

    // Excludes cancelled/failed orders — an abandoned online-payment
    // checkout (never actually paid; see api/cron/expire-unpaid-orders.ts)
    // shouldn't count as a real order any more than it should count as a
    // sale.
    const ordersCount = currentOrders.filter(
      (o) => !VOID_STATUSES.has(o.status) && matchesChannel(o.source),
    ).length
    const previousOrdersCount = previousOrders.filter(
      (o) => !VOID_STATUSES.has(o.status) && matchesChannel(o.source),
    ).length

    // Conversion rate is an online-store-only metric: storefront visits
    // vs. storefront purchases. Orders placed on TikTok/Shopee/Lazada never
    // came through a storefront page view, so counting them here would
    // inflate the rate against a denominator that can't see them.
    const storefrontOrdersCount = currentOrders.filter(
      (o) => o.source === 'storefront' && !VOID_STATUSES.has(o.status),
    ).length
    const previousStorefrontOrdersCount = previousOrders.filter(
      (o) => o.source === 'storefront' && !VOID_STATUSES.has(o.status),
    ).length
    const conversionRate =
      uniqueVisitors.size > 0
        ? (storefrontOrdersCount / uniqueVisitors.size) * 100
        : null
    const previousConversionRate =
      previousUniqueVisitors.size > 0
        ? (previousStorefrontOrdersCount / previousUniqueVisitors.size) * 100
        : null

    const aovCents = ordersCount > 0 ? Math.round(salesCents / ordersCount) : null
    const previousAovCents =
      previousOrdersCount > 0
        ? Math.round(previousSalesCents / previousOrdersCount)
        : null

    return {
      range: { from: data.from, to: data.to },
      sales: { cents: salesCents, previousCents: previousSalesCents },
      orders: { count: ordersCount, previousCount: previousOrdersCount },
      visitors: {
        count: uniqueVisitors.size,
        previousCount: previousUniqueVisitors.size,
      },
      conversionRate: {
        rate: conversionRate,
        previousRate: previousConversionRate,
      },
      averageOrderValue: { cents: aovCents, previousCents: previousAovCents },
      daily,
    }
  })

const LIVE_WINDOW_MS = 90_000

/**
 * Count of storefront_presence rows heartbeat-updated within the last
 * ~90s (3x the client's ~20s heartbeat interval, tolerating a couple of
 * missed pings) — a live "who's on the site right now" count, separate
 * from getDashboardAnalytics's historical range-scoped visitors count.
 * Own server fn, not merged into that one: different cadence (polled
 * frequently, no date range) and different query (current state, not an
 * aggregation over storefront_visits).
 */
export const getLiveViewerCount = createServerFn({ method: 'GET' })
  .validator(z.object({ brand: z.string().optional() }))
  .handler(async ({ data }): Promise<{ count: number }> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const since = new Date(Date.now() - LIVE_WINDOW_MS).toISOString()
    let query = admin
      .from('storefront_presence')
      .select('visitor_id', { count: 'exact', head: true })
      .gte('last_seen_at', since)
    if (data.brand) query = query.eq('brand', data.brand)
    const { count, error } = await query
    if (error) throw error
    return { count: count ?? 0 }
  })

// Personal/test accounts used for poking around the storefront — never a
// real customer's lifetime value, so always excluded from these figures
// regardless of what they've spent.
const EXCLUDED_CLV_EMAILS = [
  'paoloxcruz02@gmail.com',
  'christianandrecawaling152@gmail.com',
]

export interface CustomerEconomicsResult {
  /** Null once there are no eligible customers to average over. */
  averageLifetimeValueCents: number | null
  /** (customers with 2+ real orders) ÷ (all eligible customers) × 100 — null
   *  once there are no eligible customers. */
  repeatPurchaseRatePct: number | null
  /** (sum of each eligible customer's real order count) ÷ (eligible
   *  customer count) — null once there are no eligible customers. */
  averageOrdersPerCustomer: number | null
  /** How many customers these figures were computed over — shown alongside
   *  them so a tiny sample size is never mistaken for a stable one. */
  customerCount: number
}

/**
 * All-time, per-customer economics: average lifetime spend, repeat purchase
 * rate, and average orders per customer — all three computed from the same
 * eligible customer set (deliberately a plain historical average, not a
 * predictive model; there's no churn-rate/purchase-frequency data to
 * honestly project from) so they never tell subtly inconsistent stories
 * about who counts.
 *
 * Eligible = real spend greater than ₱0 (a $0-lifetime customer — e.g. a
 * guest row the email-capture popup created that never converted — would
 * otherwise drag every average down for no meaningful reason) and not one
 * of the excluded personal/test accounts above.
 *
 * Deliberately NOT date-ranged or channel-filtered, unlike
 * getDashboardAnalytics above — "lifetime" doesn't fit a date window, and a
 * customer's full relationship should count regardless of which channel
 * any one of their orders came through. Brand still applies, since
 * Spades/Ysrael/Aspire 365 customers are meaningfully different pools.
 */
export const getCustomerEconomics = createServerFn({
  method: 'GET',
})
  .validator(z.object({ brand: z.string().optional() }))
  .handler(async ({ data }): Promise<CustomerEconomicsResult> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const { data: excludedCustomers, error: excludedError } = await admin
      .from('customers')
      .select('id')
      .in('email', EXCLUDED_CLV_EMAILS)
    if (excludedError) throw excludedError
    const excludedIds = new Set(excludedCustomers.map((c) => c.id))

    const orders = await fetchAllRows((offset) => {
      let query = admin
        .from('orders')
        .select('customer_id, total_cents, status')
        .range(offset, offset + 999)
      if (data.brand) query = query.eq('brand', data.brand)
      return query
    })

    const spendByCustomer = new Map<string, number>()
    const orderCountByCustomer = new Map<string, number>()
    for (const order of orders) {
      if (VOID_STATUSES.has(order.status)) continue
      if (excludedIds.has(order.customer_id)) continue
      spendByCustomer.set(
        order.customer_id,
        (spendByCustomer.get(order.customer_id) ?? 0) + order.total_cents,
      )
      orderCountByCustomer.set(
        order.customer_id,
        (orderCountByCustomer.get(order.customer_id) ?? 0) + 1,
      )
    }

    // Only customers who've actually spent something are eligible — see
    // the doc comment above.
    const eligibleCustomerIds = Array.from(spendByCustomer.keys()).filter(
      (id) => (spendByCustomer.get(id) ?? 0) > 0,
    )
    if (eligibleCustomerIds.length === 0) {
      return {
        averageLifetimeValueCents: null,
        repeatPurchaseRatePct: null,
        averageOrdersPerCustomer: null,
        customerCount: 0,
      }
    }

    const totalSpendCents = eligibleCustomerIds.reduce(
      (sum, id) => sum + (spendByCustomer.get(id) ?? 0),
      0,
    )
    const totalOrders = eligibleCustomerIds.reduce(
      (sum, id) => sum + (orderCountByCustomer.get(id) ?? 0),
      0,
    )
    const repeatCustomerCount = eligibleCustomerIds.filter(
      (id) => (orderCountByCustomer.get(id) ?? 0) >= 2,
    ).length

    return {
      averageLifetimeValueCents: Math.round(
        totalSpendCents / eligibleCustomerIds.length,
      ),
      repeatPurchaseRatePct:
        (repeatCustomerCount / eligibleCustomerIds.length) * 100,
      averageOrdersPerCustomer: totalOrders / eligibleCustomerIds.length,
      customerCount: eligibleCustomerIds.length,
    }
  })

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
    point.orders += 1
    if (!isVoid) point.salesCents += order.total_cents
    if (order.source === 'storefront') point.storefrontOrders += 1
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
  previousOrders: number
  previousSalesCents: number
  previousVisitors: number
  previousConversionRate: number | null
}

export interface DashboardAnalytics {
  range: { from: string; to: string }
  sales: { cents: number; previousCents: number }
  orders: { count: number; previousCount: number }
  visitors: { count: number; previousCount: number }
  conversionRate: { rate: number | null; previousRate: number | null }
  daily: DailyPoint[]
}

export const getDashboardAnalytics = createServerFn({ method: 'GET' })
  .validator(z.object({ from: z.string(), to: z.string() }))
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

    const [current, previous, visitsCurrent, visitsPrevious] =
      await Promise.all([
        admin
          .from('orders')
          .select('placed_at, total_cents, status, source')
          .gte('placed_at', rangeStart)
          .lte('placed_at', rangeEnd),
        admin
          .from('orders')
          .select('placed_at, total_cents, status, source')
          .gte('placed_at', prevStart)
          .lte('placed_at', prevEnd),
        admin
          .from('storefront_visits')
          .select('visitor_id, created_at')
          .eq('event_type', 'page_view')
          .gte('created_at', rangeStart)
          .lte('created_at', rangeEnd),
        admin
          .from('storefront_visits')
          .select('visitor_id, created_at')
          .eq('event_type', 'page_view')
          .gte('created_at', prevStart)
          .lte('created_at', prevEnd),
      ])

    if (current.error) throw current.error
    if (previous.error) throw previous.error
    if (visitsCurrent.error) throw visitsCurrent.error
    if (visitsPrevious.error) throw visitsPrevious.error

    // A single-day range (e.g. "Today") gets bucketed by hour instead of by
    // day — one data point for the whole day would be a flat, useless
    // chart. Anything wider stays bucketed by day, same as before.
    const isSingleDay = data.from === data.to

    const currentBuckets = bucketPeriod(
      data.from,
      data.to,
      isSingleDay,
      current.data,
      visitsCurrent.data,
    )
    const previousBuckets = bucketPeriod(
      prev.from,
      prev.to,
      isSingleDay,
      previous.data,
      visitsPrevious.data,
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
        previousOrders: prevPoint?.orders ?? 0,
        previousSalesCents: prevPoint?.salesCents ?? 0,
        previousVisitors: prevPoint?.visitors ?? 0,
        previousConversionRate:
          prevPoint && prevPoint.visitors > 0
            ? (prevPoint.storefrontOrders / prevPoint.visitors) * 100
            : null,
      }
    })

    let salesCents = 0
    for (const order of current.data) {
      if (!VOID_STATUSES.has(order.status)) salesCents += order.total_cents
    }

    const previousSalesCents = previous.data
      .filter((o) => !VOID_STATUSES.has(o.status))
      .reduce((sum, o) => sum + o.total_cents, 0)

    const uniqueVisitors = new Set(visitsCurrent.data.map((v) => v.visitor_id))
    const previousUniqueVisitors = new Set(
      visitsPrevious.data.map((v) => v.visitor_id),
    )

    const ordersCount = current.data.length
    const previousOrdersCount = previous.data.length

    // Conversion rate is an online-store-only metric: storefront visits
    // vs. storefront purchases. Orders placed on TikTok/Shopee/Lazada never
    // came through a storefront page view, so counting them here would
    // inflate the rate against a denominator that can't see them.
    const storefrontOrdersCount = current.data.filter(
      (o) => o.source === 'storefront',
    ).length
    const previousStorefrontOrdersCount = previous.data.filter(
      (o) => o.source === 'storefront',
    ).length
    const conversionRate =
      uniqueVisitors.size > 0
        ? (storefrontOrdersCount / uniqueVisitors.size) * 100
        : null
    const previousConversionRate =
      previousUniqueVisitors.size > 0
        ? (previousStorefrontOrdersCount / previousUniqueVisitors.size) * 100
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
      daily,
    }
  })

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { previousPeriod } from '#/lib/utils/date-range'

const VOID_STATUSES = new Set(['cancelled', 'failed'])

export interface DailyPoint {
  date: string
  orders: number
  salesCents: number
  visitors: number
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
    const rangeStart = `${data.from}T00:00:00.000Z`
    const rangeEnd = `${data.to}T23:59:59.999Z`
    const prevStart = `${prev.from}T00:00:00.000Z`
    const prevEnd = `${prev.to}T23:59:59.999Z`

    const [current, previous, visitsCurrent, visitsPrevious] =
      await Promise.all([
        admin
          .from('orders')
          .select('placed_at, total_cents, status, source')
          .gte('placed_at', rangeStart)
          .lte('placed_at', rangeEnd),
        admin
          .from('orders')
          .select('total_cents, status, source')
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
          .select('visitor_id')
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
    const bucketKey = (iso: string) =>
      isSingleDay ? iso.slice(0, 13) : iso.slice(0, 10)

    const dailyMap = new Map<string, DailyPoint>()
    const dailyVisitorSets = new Map<string, Set<string>>()
    if (isSingleDay) {
      for (let hour = 0; hour < 24; hour++) {
        const hh = String(hour).padStart(2, '0')
        const key = `${data.from}T${hh}`
        const label = new Date(`${data.from}T${hh}:00:00`).toLocaleTimeString(
          'en-US',
          { hour: 'numeric' },
        )
        dailyMap.set(key, {
          date: label,
          orders: 0,
          salesCents: 0,
          visitors: 0,
        })
        dailyVisitorSets.set(key, new Set())
      }
    } else {
      for (
        const d = new Date(`${data.from}T00:00:00`);
        d <= new Date(`${data.to}T00:00:00`);
        d.setDate(d.getDate() + 1)
      ) {
        const key = d.toISOString().slice(0, 10)
        dailyMap.set(key, { date: key, orders: 0, salesCents: 0, visitors: 0 })
        dailyVisitorSets.set(key, new Set())
      }
    }

    let salesCents = 0
    for (const order of current.data) {
      const bucket = dailyMap.get(bucketKey(order.placed_at))
      const isVoid = VOID_STATUSES.has(order.status)
      if (bucket) {
        bucket.orders += 1
        if (!isVoid) bucket.salesCents += order.total_cents
      }
      if (!isVoid) salesCents += order.total_cents
    }

    const previousSalesCents = previous.data
      .filter((o) => !VOID_STATUSES.has(o.status))
      .reduce((sum, o) => sum + o.total_cents, 0)

    const uniqueVisitors = new Set<string>()
    for (const visit of visitsCurrent.data) {
      uniqueVisitors.add(visit.visitor_id)
      dailyVisitorSets.get(bucketKey(visit.created_at))?.add(visit.visitor_id)
    }
    for (const [key, set] of dailyVisitorSets) {
      const bucket = dailyMap.get(key)
      if (bucket) bucket.visitors = set.size
    }

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
      daily: Array.from(dailyMap.values()),
    }
  })

import { useEffect, useState } from 'react'
import { z } from 'zod'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  getCustomerEconomics,
  getDashboardAnalytics,
  getLiveViewerCount,
} from '#/server/admin/dashboard'
import type { CustomerEconomicsResult } from '#/server/admin/dashboard'
import {
  getSalesByChannel,
  getSalesByCustomerType,
} from '#/server/admin/analytics'
import { formatCentsAsPHP } from '#/lib/utils/money'
import {
  DATE_RANGE_PRESETS,
  percentChange,
  resolveDateRange,
} from '#/lib/utils/date-range'
import type { DateRangePreset } from '#/lib/utils/date-range'
import {
  STOREFRONT_BRAND_LABELS,
  STOREFRONT_BRANDS,
} from '#/lib/validation/admin/storefront-sections'
import type { OrderSource } from '#/types/entities'
import { Card } from '#/components/admin/Card'
import { PageHeader } from '#/components/admin/PageHeader'
import { DateRangePicker } from '#/components/admin/DateRangePicker'
import { FilterDropdown } from '#/components/admin/FilterDropdown'
import { DonutChart } from '#/components/admin/DonutChart'
import {
  MetricSparkline,
  TrendLineChart,
} from '#/components/admin/DashboardTrendChart'

const SALES_COLOR = '#2c6ecb'
const ORDERS_COLOR = '#16a34a'
const VISITORS_COLOR = '#ea580c'
const CONVERSION_COLOR = '#7c3aed'
const AOV_COLOR = '#0d9488'

const SOURCE_LABELS: Record<OrderSource, string> = {
  storefront: 'Online Store',
  admin: 'Admin (manual)',
  tiktok_shop: 'TikTok Shop',
  shopee: 'Shopee',
  lazada: 'Lazada',
}

const CHANNEL_COLORS: Record<OrderSource, string> = {
  storefront: '#171717',
  tiktok_shop: '#34d399',
  shopee: '#fb923c',
  lazada: '#8b5cf6',
  admin: '#94a3b8',
}

const CUSTOMER_TYPE_COLORS = {
  firstTime: '#f59e0b',
  repeat: '#0ea5e9',
}

const BRAND_OPTIONS = STOREFRONT_BRANDS.map((brand) => ({
  value: brand,
  label: STOREFRONT_BRAND_LABELS[brand],
}))

// Matches CHANNEL_OPTIONS in routes/admin/orders/index.tsx — orders.source
// values, not stored/shared centrally there either.
const CHANNEL_VALUES = [
  'storefront',
  'tiktok_shop',
  'shopee',
  'lazada',
] as const satisfies readonly OrderSource[]
const CHANNEL_OPTIONS = [
  { value: 'storefront', label: 'Online Store' },
  { value: 'tiktok_shop', label: 'TikTok Shop' },
  { value: 'shopee', label: 'Shopee' },
  { value: 'lazada', label: 'Lazada' },
] as const

const LIVE_POLL_MS = 15_000

/** Polls getLiveViewerCount on an interval — no React Query in this repo, so this is a plain hook. */
function useLiveViewerCount(brand: string | undefined) {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const poll = () =>
      getLiveViewerCount({ data: { brand } }).then((r) => {
        if (!cancelled) setCount(r.count)
      })

    poll()
    const id = setInterval(poll, LIVE_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [brand])

  return count
}

/** Re-fetches only on brand change — deliberately independent of the main
 *  loader's date range/channel deps, since these are all-time figures that
 *  don't fit a date window and aren't channel-scoped (see
 *  getCustomerEconomics's own doc comment). */
function useCustomerEconomics(brand: string | undefined) {
  const [result, setResult] = useState<CustomerEconomicsResult | null>(null)

  useEffect(() => {
    let cancelled = false
    getCustomerEconomics({ data: { brand } }).then((r) => {
      if (!cancelled) setResult(r)
    })
    return () => {
      cancelled = true
    }
  }, [brand])

  return result
}

export const Route = createFileRoute('/admin/')({
  validateSearch: z.object({
    range: z.enum(DATE_RANGE_PRESETS).catch('today'),
    from: z.string().optional(),
    to: z.string().optional(),
    brand: z.enum(STOREFRONT_BRANDS).optional(),
    channel: z.enum(CHANNEL_VALUES).optional(),
  }),
  loaderDeps: ({ search }) => ({
    range: search.range,
    from: search.from,
    to: search.to,
    brand: search.brand,
    channel: search.channel,
  }),
  loader: async ({ deps }) => {
    const resolved = resolveDateRange(deps.range, {
      from: deps.from,
      to: deps.to,
    })
    const [analytics, salesByChannel, salesByCustomerType] = await Promise.all(
      [
        getDashboardAnalytics({
          data: { ...resolved, brand: deps.brand, channel: deps.channel },
        }),
        getSalesByChannel({
          data: { ...resolved, brand: deps.brand, channel: deps.channel },
        }),
        getSalesByCustomerType({
          data: { ...resolved, brand: deps.brand, channel: deps.channel },
        }),
      ],
    )
    return { analytics, salesByChannel, salesByCustomerType }
  },
  component: AdminPage,
})

function AdminPage() {
  const { analytics, salesByChannel, salesByCustomerType } =
    Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const liveCount = useLiveViewerCount(search.brand)
  const customerEconomics = useCustomerEconomics(search.brand)

  function handleRangeChange(
    preset: DateRangePreset,
    custom?: { from: string; to: string },
  ) {
    navigate({
      search: (prev) => ({
        ...prev,
        range: preset,
        from: custom?.from,
        to: custom?.to,
      }),
    })
  }

  const salesTrend = percentChange(
    analytics.sales.cents,
    analytics.sales.previousCents,
  )
  const ordersTrend = percentChange(
    analytics.orders.count,
    analytics.orders.previousCount,
  )
  const visitorsTrend = percentChange(
    analytics.visitors.count,
    analytics.visitors.previousCount,
  )
  const conversionTrend =
    analytics.conversionRate.rate !== null &&
    analytics.conversionRate.previousRate !== null
      ? percentChange(
          analytics.conversionRate.rate,
          analytics.conversionRate.previousRate,
        )
      : null
  const aovTrend =
    analytics.averageOrderValue.cents !== null &&
    analytics.averageOrderValue.previousCents !== null
      ? percentChange(
          analytics.averageOrderValue.cents,
          analytics.averageOrderValue.previousCents,
        )
      : null

  const salesChartData = analytics.daily.map((d) => ({
    label: d.date,
    current: d.salesCents,
    previous: d.previousSalesCents,
  }))
  const ordersChartData = analytics.daily.map((d) => ({
    label: d.date,
    current: d.orders,
    previous: d.previousOrders,
  }))
  const visitorsChartData = analytics.daily.map((d) => ({
    label: d.date,
    current: d.visitors,
    previous: d.previousVisitors,
  }))
  const conversionChartData = analytics.daily.map((d) => ({
    label: d.date,
    current: d.conversionRate ?? 0,
    previous: d.previousConversionRate ?? 0,
  }))
  const aovChartData = analytics.daily.map((d) => ({
    label: d.date,
    current: d.aovCents ?? 0,
    previous: d.previousAovCents ?? 0,
  }))

  const salesByChannelSlices = salesByChannel.channels.map((c) => ({
    label: SOURCE_LABELS[c.source],
    value: Math.max(c.netSalesCents, 0),
    color: CHANNEL_COLORS[c.source],
  }))
  const customerTypeSlices = [
    {
      label: '1st-time customers',
      value: Math.max(salesByCustomerType.firstTime.salesCents, 0),
      color: CUSTOMER_TYPE_COLORS.firstTime,
    },
    {
      label: 'Repeat customers',
      value: Math.max(salesByCustomerType.repeat.salesCents, 0),
      color: CUSTOMER_TYPE_COLORS.repeat,
    },
  ]

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Home"
        subtitle="A quick look at your store."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <LiveViewersBadge count={liveCount} />
            <FilterDropdown
              label="Brand"
              value={search.brand}
              options={BRAND_OPTIONS}
              onChange={(brand) =>
                navigate({ search: (prev) => ({ ...prev, brand }) })
              }
            />
            <FilterDropdown
              label="Channel"
              value={search.channel}
              options={CHANNEL_OPTIONS}
              onChange={(channel) =>
                navigate({ search: (prev) => ({ ...prev, channel }) })
              }
            />
            <DateRangePicker
              preset={search.range}
              from={analytics.range.from}
              to={analytics.range.to}
              onChange={handleRangeChange}
            />
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm font-medium text-neutral-500">Sales</p>
          <div className="mt-2 flex items-end justify-between">
            <div className="flex items-center gap-2">
              <p className="text-3xl font-semibold text-neutral-900">
                {formatCentsAsPHP(analytics.sales.cents)}
              </p>
              <MetricSparkline
                values={analytics.daily.map((d) => d.salesCents)}
                color={SALES_COLOR}
              />
            </div>
            <TrendTag value={salesTrend} />
          </div>
          <div className="mt-4">
            <TrendLineChart
              data={salesChartData}
              color={SALES_COLOR}
              formatValue={formatCentsAsPHP}
              syncId="dashboard-trends"
            />
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-sm font-medium text-neutral-500">Orders</p>
          <div className="mt-2 flex items-end justify-between">
            <div className="flex items-center gap-2">
              <p className="text-3xl font-semibold text-neutral-900">
                {analytics.orders.count}
              </p>
              <MetricSparkline
                values={analytics.daily.map((d) => d.orders)}
                color={ORDERS_COLOR}
              />
            </div>
            <TrendTag value={ordersTrend} />
          </div>
          <div className="mt-4">
            <TrendLineChart
              data={ordersChartData}
              color={ORDERS_COLOR}
              formatValue={(v) => `${v} ${v === 1 ? 'order' : 'orders'}`}
              syncId="dashboard-trends"
            />
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-sm font-medium text-neutral-500">Visitors</p>
          <div className="mt-2 flex items-end justify-between">
            <p className="text-3xl font-semibold text-neutral-900">
              {analytics.visitors.count}
            </p>
            <TrendTag value={visitorsTrend} />
          </div>
          <div className="mt-4">
            <TrendLineChart
              data={visitorsChartData}
              color={VISITORS_COLOR}
              formatValue={(v) => `${v} ${v === 1 ? 'visitor' : 'visitors'}`}
              syncId="dashboard-trends"
            />
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-sm font-medium text-neutral-500">
            Conversion rate
          </p>
          <div className="mt-2 flex items-end justify-between">
            <div className="flex items-center gap-2">
              <p className="text-3xl font-semibold text-neutral-900">
                {analytics.conversionRate.rate === null
                  ? '—'
                  : `${analytics.conversionRate.rate.toFixed(2)}%`}
              </p>
              <MetricSparkline
                values={analytics.daily.map((d) => d.conversionRate ?? 0)}
                color={CONVERSION_COLOR}
              />
            </div>
            <TrendTag value={conversionTrend} />
          </div>
          <div className="mt-4">
            <TrendLineChart
              data={conversionChartData}
              color={CONVERSION_COLOR}
              formatValue={(v) => `${v.toFixed(2)}%`}
              syncId="dashboard-trends"
            />
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-sm font-medium text-neutral-500">
            Average order value
          </p>
          <div className="mt-2 flex items-end justify-between">
            <div className="flex items-center gap-2">
              <p className="text-3xl font-semibold text-neutral-900">
                {analytics.averageOrderValue.cents === null
                  ? '—'
                  : formatCentsAsPHP(analytics.averageOrderValue.cents)}
              </p>
              <MetricSparkline
                values={analytics.daily.map((d) => d.aovCents ?? 0)}
                color={AOV_COLOR}
              />
            </div>
            <TrendTag value={aovTrend} />
          </div>
          <div className="mt-4">
            <TrendLineChart
              data={aovChartData}
              color={AOV_COLOR}
              formatValue={formatCentsAsPHP}
              syncId="dashboard-trends"
            />
          </div>
        </Card>

        <Card className="p-5">
          <p className="text-sm font-medium text-neutral-500">
            Average customer lifetime value
          </p>
          <p className="mt-2 text-3xl font-semibold text-neutral-900">
            {customerEconomics?.averageLifetimeValueCents == null
              ? '—'
              : formatCentsAsPHP(customerEconomics.averageLifetimeValueCents)}
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            {customerEconomics && customerEconomics.customerCount > 0
              ? `Across ${customerEconomics.customerCount} customer${customerEconomics.customerCount === 1 ? '' : 's'}, all-time`
              : 'All-time — not scoped to the date range above'}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-neutral-100 pt-4">
            <div>
              <p className="text-xs text-neutral-500">Repeat purchase rate</p>
              <p className="mt-1 text-lg font-semibold text-neutral-900">
                {customerEconomics?.repeatPurchaseRatePct == null
                  ? '—'
                  : `${customerEconomics.repeatPurchaseRatePct.toFixed(1)}%`}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500">Avg orders / customer</p>
              <p className="mt-1 text-lg font-semibold text-neutral-900">
                {customerEconomics?.averageOrdersPerCustomer == null
                  ? '—'
                  : customerEconomics.averageOrdersPerCustomer.toFixed(2)}
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-neutral-900">
            Sales by Channel
          </h2>
          <p className="text-xs text-neutral-500">
            Net sales — gross sales minus discounts and refunds
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-10">
            <DonutChart slices={salesByChannelSlices} />
            <div className="flex flex-col gap-3">
              {salesByChannel.channels.map((c) => (
                <div
                  key={c.source}
                  className="flex items-center justify-between gap-8"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: CHANNEL_COLORS[c.source] }}
                    />
                    <span className="text-sm text-neutral-700">
                      {SOURCE_LABELS[c.source]}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-neutral-900">
                    {formatCentsAsPHP(c.netSalesCents)}
                  </p>
                </div>
              ))}
              {salesByChannel.channels.length === 0 && (
                <p className="text-sm text-neutral-400">
                  No sales in this range.
                </p>
              )}
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">
                1st-time vs. Repeat Customers
              </h2>
              <p className="text-xs text-neutral-500">
                Sales split by whether the customer had already ordered
                before this range
              </p>
            </div>
            {salesByCustomerType.retentionRatePct !== null && (
              <div className="text-right">
                <p className="text-xl font-semibold text-neutral-900">
                  {salesByCustomerType.retentionRatePct.toFixed(1)}%
                </p>
                <p className="text-xs text-neutral-400">retention rate</p>
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-10">
            <DonutChart slices={customerTypeSlices} />
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-8">
                <div className="flex items-center gap-2">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: CUSTOMER_TYPE_COLORS.firstTime }}
                  />
                  <span className="text-sm text-neutral-700">
                    1st-time customers
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-neutral-900">
                    {formatCentsAsPHP(salesByCustomerType.firstTime.salesCents)}
                  </p>
                  <p className="text-xs text-neutral-400">
                    {salesByCustomerType.firstTime.customerCount} customer
                    {salesByCustomerType.firstTime.customerCount === 1
                      ? ''
                      : 's'}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-8">
                <div className="flex items-center gap-2">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: CUSTOMER_TYPE_COLORS.repeat }}
                  />
                  <span className="text-sm text-neutral-700">
                    Repeat customers
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-neutral-900">
                    {formatCentsAsPHP(salesByCustomerType.repeat.salesCents)}
                  </p>
                  <p className="text-xs text-neutral-400">
                    {salesByCustomerType.repeat.customerCount} customer
                    {salesByCustomerType.repeat.customerCount === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              {salesByCustomerType.firstTime.customerCount === 0 &&
                salesByCustomerType.repeat.customerCount === 0 && (
                  <p className="text-sm text-neutral-400">
                    No customers in this range.
                  </p>
                )}
            </div>
          </div>
        </Card>
      </div>

      <p className="mt-3 text-xs text-neutral-400">
        Sales and orders are calculated from real order data; cancelled and
        failed orders are excluded from sales. Visitors count unique anonymous
        browser ids seen on the storefront during the selected period — visits
        before this feature shipped aren't counted retroactively. Conversion
        rate is online-store orders ÷ unique visitors. Average order value is
        sales ÷ orders over the selected range. Dashed lines show the
        previous period for comparison. Average customer lifetime value,
        repeat purchase rate, and average orders per customer are all
        computed over the same customer population — everyone who's spent
        more than ₱0, all-time, not affected by the date range above. Repeat
        purchase rate is the share of those customers with 2 or more orders.
      </p>
    </div>
  )
}

function LiveViewersBadge({ count }: { count: number | null }) {
  if (count === null) return null
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
      </span>
      {count} live now
    </span>
  )
}

function TrendTag({ value }: { value: number | null }) {
  if (value === null) return null
  const tone = value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'
  const colorClass =
    tone === 'positive'
      ? 'text-green-700 bg-green-50'
      : tone === 'negative'
        ? 'text-red-700 bg-red-50'
        : 'text-neutral-600 bg-neutral-100'
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}
    >
      {value > 0 ? '+' : ''}
      {value}%
    </span>
  )
}

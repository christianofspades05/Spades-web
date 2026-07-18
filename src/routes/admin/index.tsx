import { z } from 'zod'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { getDashboardAnalytics } from '#/server/admin/dashboard'
import { formatCentsAsPHP } from '#/lib/utils/money'
import {
  DATE_RANGE_PRESETS,
  percentChange,
  resolveDateRange,
} from '#/lib/utils/date-range'
import type { DateRangePreset } from '#/lib/utils/date-range'
import { Card } from '#/components/admin/Card'
import { PageHeader } from '#/components/admin/PageHeader'
import { DateRangePicker } from '#/components/admin/DateRangePicker'
import {
  MetricSparkline,
  TrendLineChart,
} from '#/components/admin/DashboardTrendChart'

const SALES_COLOR = '#2c6ecb'
const ORDERS_COLOR = '#16a34a'
const VISITORS_COLOR = '#ea580c'
const CONVERSION_COLOR = '#7c3aed'

export const Route = createFileRoute('/admin/')({
  validateSearch: z.object({
    range: z.enum(DATE_RANGE_PRESETS).catch('today'),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  loaderDeps: ({ search }) => ({
    range: search.range,
    from: search.from,
    to: search.to,
  }),
  loader: ({ deps }) => {
    const resolved = resolveDateRange(deps.range, {
      from: deps.from,
      to: deps.to,
    })
    return getDashboardAnalytics({ data: resolved })
  },
  component: AdminPage,
})

function AdminPage() {
  const analytics = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  function handleRangeChange(
    preset: DateRangePreset,
    custom?: { from: string; to: string },
  ) {
    navigate({
      search: { range: preset, from: custom?.from, to: custom?.to },
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

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Home"
        subtitle="A quick look at your store."
        action={
          <DateRangePicker
            preset={search.range}
            from={analytics.range.from}
            to={analytics.range.to}
            onChange={handleRangeChange}
          />
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
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
      </div>

      <p className="mt-3 text-xs text-neutral-400">
        Sales and orders are calculated from real order data; cancelled and
        failed orders are excluded from sales. Visitors count unique anonymous
        browser ids seen on the storefront during the selected period — visits
        before this feature shipped aren't counted retroactively. Conversion
        rate is online-store orders ÷ unique visitors. Dashed lines show the
        previous period for comparison.
      </p>
    </div>
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

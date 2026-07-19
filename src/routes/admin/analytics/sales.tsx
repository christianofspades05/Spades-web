import { useState } from 'react'
import { z } from 'zod'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Package } from 'lucide-react'
import {
  getProductProfitBreakdown,
  getSalesAnalytics,
} from '#/server/admin/analytics'
import type { ProductProfitRow } from '#/server/admin/analytics'
import { formatCentsAsPHP } from '#/lib/utils/money'
import {
  DATE_RANGE_PRESETS,
  resolveDateRange,
} from '#/lib/utils/date-range'
import type { DateRangePreset } from '#/lib/utils/date-range'
import { Card } from '#/components/admin/Card'
import { PageHeader } from '#/components/admin/PageHeader'
import { DateRangePicker } from '#/components/admin/DateRangePicker'
import { FilterDropdown } from '#/components/admin/FilterDropdown'
import { TrendLineChart } from '#/components/admin/DashboardTrendChart'
import {
  buttonSecondaryClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

const CHANNEL_OPTIONS = [
  { value: 'storefront', label: 'Online Store' },
  { value: 'tiktok_shop', label: 'TikTok Shop' },
  { value: 'shopee', label: 'Shopee' },
  { value: 'lazada', label: 'Lazada' },
] as const

export const Route = createFileRoute('/admin/analytics/sales')({
  validateSearch: z.object({
    range: z.enum(DATE_RANGE_PRESETS).catch('last_30_days'),
    from: z.string().optional(),
    to: z.string().optional(),
    channel: z
      .enum(['storefront', 'tiktok_shop', 'shopee', 'lazada'])
      .optional(),
    compare: z.boolean().catch(false),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const resolved = resolveDateRange(deps.range, {
      from: deps.from,
      to: deps.to,
    })
    const [salesAnalytics, bestSellers] = await Promise.all([
      getSalesAnalytics({
        data: {
          ...resolved,
          channel: deps.channel,
          comparePrevious: deps.compare,
        },
      }),
      getProductProfitBreakdown({
        data: { ...resolved, channel: deps.channel },
      }),
    ])
    return { salesAnalytics, bestSellers }
  },
  component: SalesAnalyticsPage,
})

function SalesAnalyticsPage() {
  const { salesAnalytics, bestSellers } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

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

  const revenueTrendData = salesAnalytics.daily.map((point) => ({
    label: point.date,
    current: point.grossSalesCents,
    previous: point.previousGrossSalesCents,
  }))
  const aovTrendData = salesAnalytics.daily.map((point) => ({
    label: point.date,
    current: point.aovCents,
    previous: point.previousAovCents,
  }))

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Sales Analytics"
        subtitle="Revenue, order value, and best-selling products by channel."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker
              preset={search.range}
              from={search.from ?? resolveDateRange(search.range, {}).from}
              to={search.to ?? resolveDateRange(search.range, {}).to}
              onChange={handleRangeChange}
            />
            <FilterDropdown
              label="Channel"
              value={search.channel}
              options={CHANNEL_OPTIONS}
              onChange={(channel) =>
                navigate({ search: (prev) => ({ ...prev, channel }) })
              }
            />
            <button
              type="button"
              onClick={() =>
                navigate({
                  search: (prev) => ({ ...prev, compare: !prev.compare }),
                })
              }
              className={`rounded-full border px-3 py-2 text-sm font-medium ${
                search.compare
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              Compare previous period
            </button>
          </div>
        }
      />

      {/* Sales breakdown */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Gross Sales</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {formatCentsAsPHP(salesAnalytics.totals.grossSalesCents)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Discounts</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {formatCentsAsPHP(salesAnalytics.totals.discountsCents)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Returns / Refunds</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {formatCentsAsPHP(salesAnalytics.totals.refundsCents)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Net Sales</p>
          <p className="mt-1 text-xl font-semibold text-emerald-600">
            {formatCentsAsPHP(salesAnalytics.totals.netSalesCents)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Cancelled Orders</p>
          <p className="mt-1 text-xl font-semibold text-red-600">
            {salesAnalytics.totals.cancelledOrderCount}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            {salesAnalytics.totals.failedDeliveryCount} failed delivery
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Cancelled Sales</p>
          <p className="mt-1 text-xl font-semibold text-red-600">
            {formatCentsAsPHP(salesAnalytics.totals.cancelledAmountCents)}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            {formatCentsAsPHP(salesAnalytics.totals.failedDeliveryAmountCents)}{' '}
            failed delivery
          </p>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-neutral-900">
            Revenue Over Time
          </h2>
          <p className="text-xs text-neutral-500">Gross sales by day</p>
          <div className="mt-4">
            <TrendLineChart
              data={revenueTrendData}
              formatValue={formatCentsAsPHP}
              syncId="sales-analytics-trends"
            />
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-neutral-900">
            Average Order Value
          </h2>
          <p className="text-xs text-neutral-500">Net sales ÷ orders, by day</p>
          <div className="mt-4">
            <TrendLineChart
              data={aovTrendData}
              formatValue={formatCentsAsPHP}
              syncId="sales-analytics-trends"
              color="#171717"
            />
          </div>
        </Card>
      </div>

      <BestSellersSection products={bestSellers} />
    </div>
  )
}

const BEST_SELLERS_PAGE_SIZE = 10

function BestSellersSection({ products }: { products: ProductProfitRow[] }) {
  const [sortBy, setSortBy] = useState<'units' | 'revenue'>('units')
  const [page, setPage] = useState(1)

  const totalRevenueCents = products.reduce(
    (sum, p) => sum + p.grossSalesCents,
    0,
  )
  const sorted = [...products].sort((a, b) =>
    sortBy === 'units'
      ? b.unitsSold - a.unitsSold
      : b.grossSalesCents - a.grossSalesCents,
  )
  const pageCount = Math.max(
    1,
    Math.ceil(sorted.length / BEST_SELLERS_PAGE_SIZE),
  )
  const currentPage = Math.min(page, pageCount)
  const paged = sorted.slice(
    (currentPage - 1) * BEST_SELLERS_PAGE_SIZE,
    currentPage * BEST_SELLERS_PAGE_SIZE,
  )

  function changeSortBy(next: 'units' | 'revenue') {
    setSortBy(next)
    setPage(1)
  }

  return (
    <div className="mt-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Best Sellers
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Ranked by {sortBy === 'units' ? 'units sold' : 'revenue'}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-full bg-neutral-100 p-1 text-xs font-medium">
          <button
            type="button"
            onClick={() => changeSortBy('units')}
            className={`rounded-full px-3 py-1.5 ${
              sortBy === 'units'
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-900'
            }`}
          >
            Units sold
          </button>
          <button
            type="button"
            onClick={() => changeSortBy('revenue')}
            className={`rounded-full px-3 py-1.5 ${
              sortBy === 'revenue'
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-500 hover:text-neutral-900'
            }`}
          >
            Revenue
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-neutral-500">No sales in this range.</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-3 md:hidden">
            {paged.map((product) => (
              <BestSellerCard
                key={product.productId ?? product.productName}
                product={product}
                totalRevenueCents={totalRevenueCents}
              />
            ))}
          </div>

          <div className={`${tableWrapperClassName} hidden md:block`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={tableHeadClassName}>Product</th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Units sold
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Revenue
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      % of sales
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((product) => (
                    <tr
                      key={product.productId ?? product.productName}
                      className={tableRowClassName}
                    >
                      <td className={tableCellClassName}>
                        <div className="flex items-center gap-3">
                          {product.imageUrl ? (
                            <img
                              src={product.imageUrl}
                              alt=""
                              className="size-9 rounded-md border border-neutral-200 object-cover"
                            />
                          ) : (
                            <div className="flex size-9 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50">
                              <Package size={14} className="text-neutral-300" />
                            </div>
                          )}
                          <p className="font-medium text-neutral-900">
                            {product.productName}
                          </p>
                        </div>
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {product.unitsSold}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {formatCentsAsPHP(product.grossSalesCents)}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {totalRevenueCents > 0
                          ? `${((product.grossSalesCents / totalRevenueCents) * 100).toFixed(1)}%`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {pageCount > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm text-neutral-500">
              <p>
                Showing {(currentPage - 1) * BEST_SELLERS_PAGE_SIZE + 1}–
                {Math.min(currentPage * BEST_SELLERS_PAGE_SIZE, sorted.length)}{' '}
                of {sorted.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className={`${buttonSecondaryClassName} disabled:opacity-40`}
                >
                  Previous
                </button>
                <span className="text-xs text-neutral-400">
                  Page {currentPage} of {pageCount}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= pageCount}
                  onClick={() => setPage((p) => p + 1)}
                  className={`${buttonSecondaryClassName} disabled:opacity-40`}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function BestSellerCard({
  product,
  totalRevenueCents,
}: {
  product: ProductProfitRow
  totalRevenueCents: number
}) {
  const share =
    totalRevenueCents > 0
      ? (product.grossSalesCents / totalRevenueCents) * 100
      : null

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt=""
            className="size-11 rounded-md border border-neutral-200 object-cover"
          />
        ) : (
          <div className="flex size-11 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50">
            <Package size={16} className="text-neutral-300" />
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate font-medium text-neutral-900">
            {product.productName}
          </p>
          <p className="text-sm text-neutral-500">
            {product.unitsSold} sold · {formatCentsAsPHP(product.grossSalesCents)}
          </p>
        </div>
      </div>
      {share !== null && (
        <p className="mt-2 text-xs text-neutral-400">
          {share.toFixed(1)}% of total sales
        </p>
      )}
    </Card>
  )
}

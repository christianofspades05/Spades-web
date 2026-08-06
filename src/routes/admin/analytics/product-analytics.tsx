import { z } from 'zod'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Package } from 'lucide-react'
import {
  getProductProfitBreakdown,
  getProductVelocitySignals,
} from '#/server/admin/analytics'
import type { ProductVelocitySignal } from '#/server/admin/analytics'
import { formatCentsAsPHP } from '#/lib/utils/money'
import {
  DATE_RANGE_PRESETS,
  resolveDateRange,
} from '#/lib/utils/date-range'
import type { DateRangePreset } from '#/lib/utils/date-range'
import { Card } from '#/components/admin/Card'
import { PageHeader } from '#/components/admin/PageHeader'
import { DateRangePicker } from '#/components/admin/DateRangePicker'
import { ProductUnitsBarChart } from '#/components/admin/ProductUnitsBarChart'
import { ProductProfitCard } from '#/components/admin/ProductProfitCard'
import {
  inputClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'
import {
  STOREFRONT_BRAND_LABELS,
  STOREFRONT_BRANDS,
} from '#/lib/validation/admin/storefront-sections'

const RESTOCK_MIN_AVG_PER_DAY = 5
const RESTOCK_MAX_CURRENT_STOCK = 30
const RESTOCK_DAYS_OF_COVER = 45
const CASH_COW_MIN_AVG_PER_DAY = 2
const CASH_COW_MAX_AVG_PER_DAY = 4
const CLEARANCE_MAX_AVG_PER_DAY = 1
const CLEARANCE_MIN_CURRENT_STOCK = 100

export const Route = createFileRoute('/admin/analytics/product-analytics')({
  validateSearch: z.object({
    range: z.enum(DATE_RANGE_PRESETS).catch('last_30_days'),
    from: z.string().optional(),
    to: z.string().optional(),
    brand: z.enum(STOREFRONT_BRANDS).optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const resolved = resolveDateRange(deps.range, {
      from: deps.from,
      to: deps.to,
    })
    const [topSellers, velocity] = await Promise.all([
      getProductProfitBreakdown({ data: { ...resolved, brand: deps.brand } }),
      getProductVelocitySignals({ data: { brand: deps.brand } }),
    ])
    return { topSellers, velocity }
  },
  component: ProductAnalyticsPage,
})

function ProductThumbnail({
  imageUrl,
  className = 'size-9',
}: {
  imageUrl: string | null
  className?: string
}) {
  return imageUrl ? (
    <img
      src={imageUrl}
      alt=""
      className={`${className} rounded-md border border-neutral-200 object-cover`}
    />
  ) : (
    <div
      className={`flex ${className} items-center justify-center rounded-md border border-neutral-200 bg-neutral-50`}
    >
      <Package size={14} className="text-neutral-300" />
    </div>
  )
}

function ProductAnalyticsPage() {
  const { topSellers, velocity } = Route.useLoaderData()
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

  const topByUnits = [...topSellers].sort((a, b) => b.unitsSold - a.unitsSold)
  const top10 = topByUnits.slice(0, 10)

  const restock = velocity
    .filter(
      (p): p is ProductVelocitySignal & { avgUnitsPerDayWhenWellStocked: number } =>
        p.avgUnitsPerDayWhenWellStocked !== null &&
        p.avgUnitsPerDayWhenWellStocked >= RESTOCK_MIN_AVG_PER_DAY &&
        p.currentStockOnHand < RESTOCK_MAX_CURRENT_STOCK,
    )
    .sort(
      (a, b) => b.avgUnitsPerDayWhenWellStocked - a.avgUnitsPerDayWhenWellStocked,
    )

  const cashCows = velocity
    .filter(
      (p) =>
        p.avgUnitsPerDay >= CASH_COW_MIN_AVG_PER_DAY &&
        p.avgUnitsPerDay <= CASH_COW_MAX_AVG_PER_DAY,
    )
    .sort((a, b) => b.avgUnitsPerDay - a.avgUnitsPerDay)

  const clearance = velocity
    .filter(
      (p) =>
        p.avgUnitsPerDay <= CLEARANCE_MAX_AVG_PER_DAY &&
        p.currentStockOnHand >= CLEARANCE_MIN_CURRENT_STOCK,
    )
    .sort((a, b) => b.currentStockOnHand - a.currentStockOnHand)

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Product Analytics"
        subtitle="Sales velocity, restock decisions, and inventory health by product."
        action={
          <select
            value={search.brand ?? ''}
            onChange={(e) =>
              navigate({
                search: (prev) => ({
                  ...prev,
                  brand: (e.target.value || undefined) as
                    (typeof STOREFRONT_BRANDS)[number] | undefined,
                }),
              })
            }
            className={inputClassName}
          >
            <option value="">All Brands</option>
            {STOREFRONT_BRANDS.map((b) => (
              <option key={b} value={b}>
                {STOREFRONT_BRAND_LABELS[b]}
              </option>
            ))}
          </select>
        }
      />

      <Card className="mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              Top Selling Products
            </h2>
            <p className="text-xs text-neutral-500">Ranked by units sold</p>
          </div>
          <DateRangePicker
            preset={search.range}
            from={search.from ?? resolveDateRange(search.range, {}).from}
            to={search.to ?? resolveDateRange(search.range, {}).to}
            onChange={handleRangeChange}
          />
        </div>

        <div className="mt-4">
          <ProductUnitsBarChart
            bars={top10.map((p) => ({
              label: p.productName,
              unitsSold: p.unitsSold,
            }))}
          />
        </div>

        {top10.length > 0 && (
          <div className="mt-5 flex flex-col gap-3 md:hidden">
            {top10.map((p) => (
              <ProductProfitCard key={p.productId ?? p.productName} product={p} />
            ))}
          </div>
        )}

        {top10.length > 0 && (
          <div className={`${tableWrapperClassName} mt-5 hidden md:block`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={tableHeadClassName}>Product</th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Units sold
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Current qty
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Gross sales
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Net profit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {top10.map((p) => (
                    <tr key={p.productId ?? p.productName} className={tableRowClassName}>
                      <td className={`${tableCellClassName} font-medium`}>
                        <div className="flex items-center gap-3">
                          <ProductThumbnail imageUrl={p.imageUrl} />
                          {p.productName}
                        </div>
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {p.unitsSold}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {p.currentStockOnHand ?? '—'}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {formatCentsAsPHP(p.grossSalesCents)}
                      </td>
                      <td
                        className={`${tableCellClassName} text-right text-emerald-600`}
                      >
                        {formatCentsAsPHP(p.netProfitCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {top10.length === 0 && (
          <p className="mt-5 text-sm text-neutral-400">
            No sales in this range.
          </p>
        )}
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="text-sm font-semibold text-neutral-900">
          Restock Decisions
        </h2>
        <p className="text-xs text-neutral-500">
          Products selling {RESTOCK_MIN_AVG_PER_DAY}+ units/day while
          well-stocked (50+ on hand), now under {RESTOCK_MAX_CURRENT_STOCK}{' '}
          units — last 30 days
        </p>

        {restock.length > 0 ? (
          <div className={`${tableWrapperClassName} mt-5`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={tableHeadClassName}>Product</th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Current stock
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Avg orders/day
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Suggested restock
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {restock.map((p) => (
                    <tr key={p.productId} className={tableRowClassName}>
                      <td className={`${tableCellClassName} font-medium`}>
                        <div className="flex items-center gap-3">
                          <ProductThumbnail imageUrl={p.imageUrl} />
                          {p.productName}
                        </div>
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {p.currentStockOnHand}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {p.avgUnitsPerDayWhenWellStocked.toFixed(1)}
                      </td>
                      <td
                        className={`${tableCellClassName} text-right font-semibold text-emerald-600`}
                      >
                        {Math.round(
                          p.avgUnitsPerDayWhenWellStocked * RESTOCK_DAYS_OF_COVER,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="mt-5 text-sm text-neutral-400">
            No products currently need restocking.
          </p>
        )}
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="text-sm font-semibold text-neutral-900">
          Cash Cow Products
        </h2>
        <p className="text-xs text-neutral-500">
          Steady performers — {CASH_COW_MIN_AVG_PER_DAY}–{CASH_COW_MAX_AVG_PER_DAY}{' '}
          orders/day on average, last 30 days
        </p>

        {cashCows.length > 0 ? (
          <div className={`${tableWrapperClassName} mt-5`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={tableHeadClassName}>Product</th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Avg orders/day
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Current stock
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cashCows.map((p) => (
                    <tr key={p.productId} className={tableRowClassName}>
                      <td className={`${tableCellClassName} font-medium`}>
                        <div className="flex items-center gap-3">
                          <ProductThumbnail imageUrl={p.imageUrl} />
                          {p.productName}
                        </div>
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {p.avgUnitsPerDay.toFixed(1)}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {p.currentStockOnHand}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="mt-5 text-sm text-neutral-400">
            No cash cow products in this range.
          </p>
        )}
      </Card>

      <Card className="mt-4 border-amber-200 bg-amber-50/40 p-5">
        <h2 className="text-sm font-semibold text-amber-900">
          Clearance Sale Candidates
        </h2>
        <p className="text-xs text-amber-700">
          {CLEARANCE_MAX_AVG_PER_DAY} order/day or fewer with{' '}
          {CLEARANCE_MIN_CURRENT_STOCK}+ units on hand — last 30 days
        </p>

        {clearance.length > 0 ? (
          <div className={`${tableWrapperClassName} mt-5 border-amber-200`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={tableHeadClassName}>Product</th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Avg orders/day
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Current stock
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {clearance.map((p) => (
                    <tr key={p.productId} className={tableRowClassName}>
                      <td className={`${tableCellClassName} font-medium`}>
                        <div className="flex items-center gap-3">
                          <ProductThumbnail imageUrl={p.imageUrl} />
                          {p.productName}
                        </div>
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {p.avgUnitsPerDay.toFixed(1)}
                      </td>
                      <td
                        className={`${tableCellClassName} text-right font-semibold text-amber-700`}
                      >
                        {p.currentStockOnHand}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="mt-5 text-sm text-amber-700/70">
            No clearance candidates right now.
          </p>
        )}
      </Card>
    </div>
  )
}

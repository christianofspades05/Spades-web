import { useState } from 'react'
import { z } from 'zod'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  getProductProfitBreakdown,
  getSalesByChannel,
} from '#/server/admin/analytics'
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
import { DonutChart } from '#/components/admin/DonutChart'
import { TrendLineChart } from '#/components/admin/DashboardTrendChart'
import { ProductProfitBarChart } from '#/components/admin/ProductProfitBarChart'
import { ProductProfitCard } from '#/components/admin/ProductProfitCard'
import {
  buttonSecondaryClassName,
  inputClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'
import type { OrderSource } from '#/types/entities'

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

export const Route = createFileRoute('/admin/analytics/profit')({
  validateSearch: z.object({
    range: z.enum(DATE_RANGE_PRESETS).catch('last_30_days'),
    from: z.string().optional(),
    to: z.string().optional(),
    channel: z
      .enum(['storefront', 'admin', 'tiktok_shop', 'shopee', 'lazada'])
      .optional(),
    compare: z.boolean().catch(false),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const resolved = resolveDateRange(deps.range, {
      from: deps.from,
      to: deps.to,
    })
    const [sales, products] = await Promise.all([
      getSalesByChannel({
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
    return { sales, products }
  },
  component: ProfitPage,
})

function ProfitPage() {
  const { sales: result, products } = Route.useLoaderData()
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

  const slices = result.channels.map((c) => ({
    label: SOURCE_LABELS[c.source],
    value: Math.max(c.netProfitCents, 0),
    color: CHANNEL_COLORS[c.source],
  }))
  const prevBySource = new Map(
    (result.previous?.channels ?? []).map((c) => [c.source, c]),
  )

  const grossProfitChange =
    result.previous &&
    percentChange(
      result.totals.netProfitCents,
      result.previous.totals.netProfitCents,
    )

  const previousDailyByIndex = result.previous?.daily ?? []
  const profitTrendData = result.daily.map((point, i) => ({
    label: point.date,
    current: point.netProfitCents,
    previous: previousDailyByIndex[i]?.netProfitCents ?? 0,
  }))
  const marginTrendData = result.daily.map((point, i) => ({
    label: point.date,
    current: point.marginPct ?? 0,
    previous: previousDailyByIndex[i]?.marginPct ?? 0,
  }))

  const topProducts = products.slice(0, 8)

  const PRODUCTS_PAGE_SIZE = 10
  const [productsPage, setProductsPage] = useState(1)
  const productsPageCount = Math.max(
    1,
    Math.ceil(products.length / PRODUCTS_PAGE_SIZE),
  )
  const currentProductsPage = Math.min(productsPage, productsPageCount)
  const pagedProducts = products.slice(
    (currentProductsPage - 1) * PRODUCTS_PAGE_SIZE,
    currentProductsPage * PRODUCTS_PAGE_SIZE,
  )

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Profit"
        subtitle="Net profit by channel, after cost of goods sold."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker
              preset={search.range}
              from={search.from ?? resolveDateRange(search.range, {}).from}
              to={search.to ?? resolveDateRange(search.range, {}).to}
              onChange={handleRangeChange}
            />
            <select
              value={search.channel ?? ''}
              onChange={(e) =>
                navigate({
                  search: (prev) => ({
                    ...prev,
                    channel: (e.target.value || undefined) as
                      OrderSource | undefined,
                  }),
                })
              }
              className={inputClassName}
            >
              <option value="">All Channels</option>
              {(Object.keys(SOURCE_LABELS) as OrderSource[]).map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
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

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Gross Profit</p>
          <p className="mt-1 text-xl font-semibold text-emerald-600">
            {formatCentsAsPHP(result.totals.netProfitCents)}
          </p>
          {grossProfitChange !== null && (
            <p
              className={`mt-0.5 text-xs ${
                grossProfitChange >= 0 ? 'text-emerald-600' : 'text-red-600'
              }`}
            >
              {grossProfitChange >= 0 ? '+' : ''}
              {grossProfitChange}% vs previous period
            </p>
          )}
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Net Profit</p>
          <p className="mt-1 text-xl font-semibold text-emerald-600">
            {formatCentsAsPHP(result.totals.netProfitCents)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Gross Margin</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {result.totals.marginPct !== null
              ? `${result.totals.marginPct.toFixed(1)}%`
              : '—'}
          </p>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-neutral-900">
            Profit Over Time
          </h2>
          <p className="text-xs text-neutral-500">Net profit by day</p>
          <div className="mt-4">
            <TrendLineChart
              data={profitTrendData}
              formatValue={formatCentsAsPHP}
              syncId="profit-trends"
            />
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-neutral-900">
            Profit Margin Trend
          </h2>
          <p className="text-xs text-neutral-500">Gross margin % by day</p>
          <div className="mt-4">
            <TrendLineChart
              data={marginTrendData}
              formatValue={(v) => `${v.toFixed(1)}%`}
              syncId="profit-trends"
              color="#171717"
            />
          </div>
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <h2 className="text-sm font-semibold text-neutral-900">
          Top Products
        </h2>
        <p className="text-xs text-neutral-500">Ranked by net profit</p>
        <div className="mt-4">
          <ProductProfitBarChart
            bars={topProducts.map((p) => ({
              label: p.productName,
              netProfitCents: p.netProfitCents,
            }))}
            formatValue={formatCentsAsPHP}
          />
        </div>

        {pagedProducts.length > 0 && (
          <div className="mt-5 flex flex-col gap-3 md:hidden">
            {pagedProducts.map((p) => (
              <ProductProfitCard key={p.productId ?? p.productName} product={p} />
            ))}
          </div>
        )}

        {products.length > 0 && (
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
                      Total gross sales
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Total net profit
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Margin %
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Product SRP
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Product cost
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Net profit/unit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagedProducts.map((p) => (
                    <tr
                      key={p.productId ?? p.productName}
                      className={tableRowClassName}
                    >
                      <td className={`${tableCellClassName} font-medium`}>
                        {p.productName}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {p.unitsSold}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {formatCentsAsPHP(p.grossSalesCents)}
                      </td>
                      <td
                        className={`${tableCellClassName} text-right text-emerald-600`}
                      >
                        {formatCentsAsPHP(p.netProfitCents)}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {p.marginPct !== null
                          ? `${p.marginPct.toFixed(1)}%`
                          : '—'}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {p.srpCents !== null
                          ? formatCentsAsPHP(p.srpCents)
                          : '—'}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {p.costCents !== null
                          ? formatCentsAsPHP(p.costCents)
                          : '—'}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {p.netProfitPerUnitCents !== null
                          ? formatCentsAsPHP(p.netProfitPerUnitCents)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {productsPageCount > 1 && (
          <div className="mt-3 flex items-center justify-between text-sm text-neutral-500">
            <p>
              Showing {(currentProductsPage - 1) * PRODUCTS_PAGE_SIZE + 1}–
              {Math.min(
                currentProductsPage * PRODUCTS_PAGE_SIZE,
                products.length,
              )}{' '}
              of {products.length}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentProductsPage <= 1}
                onClick={() => setProductsPage((p) => p - 1)}
                className={`${buttonSecondaryClassName} disabled:opacity-40`}
              >
                Previous
              </button>
              <span className="text-xs text-neutral-400">
                Page {currentProductsPage} of {productsPageCount}
              </span>
              <button
                type="button"
                disabled={currentProductsPage >= productsPageCount}
                onClick={() => setProductsPage((p) => p + 1)}
                className={`${buttonSecondaryClassName} disabled:opacity-40`}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </Card>

      <Card className="mt-4 p-6">
        <h2 className="text-sm font-semibold text-neutral-900">
          Net Profit by Channel
        </h2>
        <p className="text-xs text-neutral-500">
          Gross sales minus cost of goods sold
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-10">
          <DonutChart slices={slices} />
          <div className="flex flex-col gap-3">
            {result.channels.map((c) => (
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
                <div className="text-right">
                  <p className="text-sm font-semibold text-emerald-600">
                    {formatCentsAsPHP(c.netProfitCents)}
                  </p>
                  <p className="text-xs text-neutral-400">
                    {c.marginPct !== null
                      ? `${c.marginPct.toFixed(1)}% margin`
                      : '—'}
                  </p>
                </div>
              </div>
            ))}
            {result.channels.length === 0 && (
              <p className="text-sm text-neutral-400">
                No sales in this range.
              </p>
            )}
          </div>
        </div>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {result.channels.map((c) => {
          const prev = prevBySource.get(c.source)
          const profitChange = prev
            ? percentChange(c.netProfitCents, prev.netProfitCents)
            : null
          return (
            <Card key={c.source} className="p-5">
              <span className="inline-block rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-600">
                {SOURCE_LABELS[c.source]}
              </span>

              <div className="mt-4">
                <p className="text-xs text-neutral-500">Net Profit</p>
                <p className="mt-1 text-xl font-semibold text-emerald-600">
                  {formatCentsAsPHP(c.netProfitCents)}
                </p>
                {profitChange !== null && (
                  <p
                    className={`mt-0.5 text-xs ${
                      profitChange >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}
                  >
                    {profitChange >= 0 ? '+' : ''}
                    {profitChange}% vs previous period
                  </p>
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-neutral-500">Margin</p>
                  <p className="mt-1 text-sm font-semibold text-neutral-900">
                    {c.marginPct !== null ? `${c.marginPct.toFixed(1)}%` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-neutral-500">Cost of Goods</p>
                  <p className="mt-1 text-sm font-semibold text-neutral-900">
                    {formatCentsAsPHP(c.costOfGoodsCents)}
                  </p>
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

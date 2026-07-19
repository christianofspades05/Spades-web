import { Fragment, useState } from 'react'
import { z } from 'zod'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  getOrderProfitList,
  getProductProfitBreakdown,
  getSalesByChannel,
} from '#/server/admin/analytics'
import type { OrderProfitRow } from '#/server/admin/analytics'
import { StatusBadge } from '#/components/admin/Badge'
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

const ORDER_PROFIT_PAGE_SIZE = 25

export const Route = createFileRoute('/admin/analytics/profit')({
  validateSearch: z.object({
    range: z.enum(DATE_RANGE_PRESETS).catch('last_30_days'),
    from: z.string().optional(),
    to: z.string().optional(),
    channel: z
      .enum(['storefront', 'admin', 'tiktok_shop', 'shopee', 'lazada'])
      .optional(),
    compare: z.boolean().catch(false),
    orderPage: z.number().int().min(1).catch(1),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const resolved = resolveDateRange(deps.range, {
      from: deps.from,
      to: deps.to,
    })
    const [sales, products, orderProfit] = await Promise.all([
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
      getOrderProfitList({
        data: {
          ...resolved,
          channel: deps.channel,
          page: deps.orderPage,
          pageSize: ORDER_PROFIT_PAGE_SIZE,
        },
      }),
    ])
    return { sales, products, orderProfit }
  },
  component: ProfitPage,
})

function ProfitPage() {
  const { sales: result, products, orderProfit } = Route.useLoaderData()
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
                  <p className="text-xs text-neutral-500">Gross Sales</p>
                  <p className="mt-1 text-sm font-semibold text-neutral-900">
                    {formatCentsAsPHP(c.grossSalesCents)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-neutral-500">Net Sales</p>
                  <p className="mt-1 text-sm font-semibold text-neutral-900">
                    {formatCentsAsPHP(c.netSalesCents)}
                  </p>
                </div>
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

      <OrderProfitSection
        result={orderProfit}
        page={search.orderPage}
        pageSize={ORDER_PROFIT_PAGE_SIZE}
        onPageChange={(page) =>
          navigate({ search: (prev) => ({ ...prev, orderPage: page }) })
        }
      />
    </div>
  )
}

function OrderProfitSection({
  result,
  page,
  pageSize,
  onPageChange,
}: {
  result: { orders: OrderProfitRow[]; total: number }
  page: number
  pageSize: number
  onPageChange: (page: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(result.total / pageSize))
  const rangeStartIndex = result.total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEndIndex = Math.min(page * pageSize, result.total)
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(
    new Set(),
  )
  const toggleExpanded = (orderId: string) => {
    setExpandedOrderIds((prev) => {
      const next = new Set(prev)
      if (next.has(orderId)) {
        next.delete(orderId)
      } else {
        next.add(orderId)
      }
      return next
    })
  }

  return (
    <div className="mt-8">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Store Orders and Their Profit
      </h2>
      <p className="mb-4 text-xs text-neutral-500">
        {result.total} {result.total === 1 ? 'order' : 'orders'} in this range
      </p>

      {result.orders.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-neutral-500">No orders in this range.</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-3 md:hidden">
            {result.orders.map((order) => (
              <Card key={order.id} className="p-4">
                <div className="flex items-center justify-between">
                  <Link
                    to="/admin/orders/$orderId"
                    params={{ orderId: order.id }}
                    className="font-medium text-neutral-900 hover:underline"
                  >
                    {order.orderNumber}
                  </Link>
                  <StatusBadge status={order.status} kind="order" />
                </div>
                <p className="mt-1 text-sm text-neutral-500">
                  {order.customerName} ·{' '}
                  {new Date(order.placedAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}{' '}
                  · {SOURCE_LABELS[order.source]}
                </p>
                <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
                  <span>Gross {formatCentsAsPHP(order.grossSalesCents)}</span>
                  <span>Net {formatCentsAsPHP(order.netSalesCents)}</span>
                </div>
                <div className="mt-2.5 flex items-center justify-between">
                  <span className="text-sm font-semibold text-emerald-600">
                    {formatCentsAsPHP(order.profitCents)} profit
                  </span>
                  <span className="text-xs text-neutral-400">
                    {order.marginPct !== null
                      ? `${order.marginPct.toFixed(1)}% margin`
                      : '—'}
                  </span>
                </div>
                {order.items.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(order.id)}
                      className="mt-2.5 flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900"
                    >
                      {expandedOrderIds.has(order.id) ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                      {order.items.length}{' '}
                      {order.items.length === 1 ? 'item' : 'items'}
                    </button>
                    {expandedOrderIds.has(order.id) && (
                      <div className="mt-2 flex flex-col gap-2 border-t border-neutral-100 pt-2">
                        {order.items.map((item, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between text-xs"
                          >
                            <div className="min-w-0 pr-2">
                              <p className="truncate text-neutral-700">
                                {item.quantity}× {item.productName}
                              </p>
                              {item.variantLabel && (
                                <p className="text-neutral-400">
                                  {item.variantLabel}
                                </p>
                              )}
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-neutral-700">
                                {formatCentsAsPHP(item.lineTotalCents)}
                              </p>
                              <p
                                className={
                                  item.profitCents >= 0
                                    ? 'text-emerald-600'
                                    : 'text-red-600'
                                }
                              >
                                {formatCentsAsPHP(item.profitCents)} profit
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </Card>
            ))}
          </div>

          <div className={`${tableWrapperClassName} hidden md:block`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={tableHeadClassName}>Order</th>
                    <th className={tableHeadClassName}>Date</th>
                    <th className={tableHeadClassName}>Status</th>
                    <th className={tableHeadClassName}>Channel</th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Gross Sales
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Net Sales
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Cost
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Shipping
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Refund
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Profit
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Margin %
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.orders.map((order) => (
                    <Fragment key={order.id}>
                      <tr className={tableRowClassName}>
                        <td className={tableCellClassName}>
                          <div className="flex items-center gap-1.5">
                            {order.items.length > 0 && (
                              <button
                                type="button"
                                onClick={() => toggleExpanded(order.id)}
                                className="shrink-0 text-neutral-400 hover:text-neutral-900"
                                aria-label={
                                  expandedOrderIds.has(order.id)
                                    ? 'Hide items'
                                    : 'Show items'
                                }
                              >
                                {expandedOrderIds.has(order.id) ? (
                                  <ChevronDown className="size-4" />
                                ) : (
                                  <ChevronRight className="size-4" />
                                )}
                              </button>
                            )}
                            <div>
                              <Link
                                to="/admin/orders/$orderId"
                                params={{ orderId: order.id }}
                                className="font-medium text-neutral-900 hover:underline"
                              >
                                {order.orderNumber}
                              </Link>
                              <p className="text-xs text-neutral-400">
                                {order.customerName}
                              </p>
                            </div>
                          </div>
                        </td>
                      <td
                        className={`${tableCellClassName} whitespace-nowrap text-neutral-500`}
                      >
                        {new Date(order.placedAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>
                      <td className={tableCellClassName}>
                        <StatusBadge status={order.status} kind="order" />
                      </td>
                      <td className={`${tableCellClassName} text-neutral-500`}>
                        {SOURCE_LABELS[order.source]}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {formatCentsAsPHP(order.grossSalesCents)}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {formatCentsAsPHP(order.netSalesCents)}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {formatCentsAsPHP(order.costCents)}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {formatCentsAsPHP(order.shippingCents)}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {order.refundCents > 0
                          ? formatCentsAsPHP(order.refundCents)
                          : '—'}
                      </td>
                      <td
                        className={`${tableCellClassName} text-right font-medium ${
                          order.profitCents >= 0
                            ? 'text-emerald-600'
                            : 'text-red-600'
                        }`}
                      >
                        {formatCentsAsPHP(order.profitCents)}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {order.marginPct !== null
                          ? `${order.marginPct.toFixed(1)}%`
                          : '—'}
                      </td>
                    </tr>
                    {expandedOrderIds.has(order.id) &&
                      order.items.length > 0 && (
                        <tr className="border-b border-neutral-100 bg-neutral-50">
                          <td colSpan={11} className="px-4 py-3">
                            <table className="w-full">
                              <tbody>
                                {order.items.map((item, index) => (
                                  <tr key={index} className="text-xs">
                                    <td className="py-1 pr-4 text-neutral-700">
                                      {item.quantity}× {item.productName}
                                      {item.variantLabel && (
                                        <span className="text-neutral-400">
                                          {' '}
                                          · {item.variantLabel}
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-1 pr-4 text-right text-neutral-500">
                                      {formatCentsAsPHP(item.lineTotalCents)}
                                    </td>
                                    <td className="py-1 pr-4 text-right text-neutral-500">
                                      cost{' '}
                                      {formatCentsAsPHP(item.costCents)}
                                    </td>
                                    <td
                                      className={`py-1 text-right font-medium ${
                                        item.profitCents >= 0
                                          ? 'text-emerald-600'
                                          : 'text-red-600'
                                      }`}
                                    >
                                      {formatCentsAsPHP(item.profitCents)}{' '}
                                      profit
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm text-neutral-500">
              <p>
                Showing {rangeStartIndex}–{rangeEndIndex} of {result.total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => onPageChange(page - 1)}
                  className={`${buttonSecondaryClassName} disabled:opacity-40`}
                >
                  Previous
                </button>
                <span className="text-xs text-neutral-400">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => onPageChange(page + 1)}
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

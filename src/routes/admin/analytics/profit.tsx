import { Fragment, useEffect, useState } from 'react'
import { z } from 'zod'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  getOrderProfitList,
  getProductProfitBreakdown,
  getSalesByChannel,
} from '#/server/admin/analytics'
import type {
  OrderProfitListTotals,
  OrderProfitRow,
} from '#/server/admin/analytics'
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
import {
  STOREFRONT_BRAND_LABELS,
  STOREFRONT_BRANDS,
} from '#/lib/validation/admin/storefront-sections'
import type { OrderSource, OrderStatus } from '#/types/entities'
import { useDebouncedValue } from '#/lib/hooks/useDebouncedValue'

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
    range: z.enum(DATE_RANGE_PRESETS).catch('this_month'),
    from: z.string().optional(),
    to: z.string().optional(),
    channel: z
      .enum(['storefront', 'admin', 'tiktok_shop', 'shopee', 'lazada'])
      .optional(),
    brand: z.enum(STOREFRONT_BRANDS).optional(),
    compare: z.boolean().catch(false),
    orderPage: z.number().int().min(1).catch(1),
    orderSearch: z.string().optional(),
    orderStatus: z
      .enum([
        'pending_payment',
        'paid',
        'processing',
        'packed',
        'shipped',
        'delivered',
        'cancelled',
        'refunded',
        'failed',
      ])
      .optional(),
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
          brand: deps.brand,
          comparePrevious: deps.compare,
        },
      }),
      getProductProfitBreakdown({
        data: { ...resolved, channel: deps.channel, brand: deps.brand },
      }),
      getOrderProfitList({
        data: {
          ...resolved,
          channel: deps.channel,
          brand: deps.brand,
          status: deps.orderStatus,
          search: deps.orderSearch,
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
        <h2 className="text-sm font-semibold text-neutral-900">Top Products</h2>
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
              <ProductProfitCard
                key={p.productId ?? p.productName}
                product={p}
              />
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
                {c.platformFeesCents > 0 && (
                  <div>
                    <p className="text-xs text-neutral-500">Platform Fees</p>
                    <p className="mt-1 text-sm font-semibold text-neutral-900">
                      {formatCentsAsPHP(c.platformFeesCents)}
                    </p>
                  </div>
                )}
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
        searchTerm={search.orderSearch ?? ''}
        onSearchChange={(orderSearch) =>
          navigate({
            search: (prev) => ({
              ...prev,
              orderSearch: orderSearch || undefined,
              orderPage: 1,
            }),
          })
        }
        status={search.orderStatus}
        onStatusChange={(orderStatus) =>
          navigate({
            search: (prev) => ({ ...prev, orderStatus, orderPage: 1 }),
          })
        }
      />
    </div>
  )
}

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: 'Pending payment',
  paid: 'Paid',
  processing: 'Processing',
  packed: 'Packed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  failed: 'Failed',
}

/** Fixed per-column pixel widths for the dense orders table — paired with
 *  `table-fixed` + a <colgroup> so sticky-positioned columns get stable,
 *  predictable left/right offsets instead of drifting with content. */
const ORDER_COL = {
  expand: 36,
  order: 108,
  customer: 190,
  date: 78,
  status: 128,
  channel: 120,
  qty: 44,
  gross: 104,
  discount: 100,
  net: 104,
  cogs: 92,
  fees: 96,
  shipping: 92,
  refund: 92,
  profit: 108,
  margin: 78,
} as const

const ORDER_TABLE_WIDTH = Object.values(ORDER_COL).reduce((a, b) => a + b, 0)
const ORDER_COL_COUNT = Object.keys(ORDER_COL).length

/** Column widths for the expanded per-product detail table — Product +
 *  Variant together span exactly the width of the parent row's
 *  Expand+Order+Customer+Date+Status+Channel columns, and every column
 *  after that reuses the parent's own widths verbatim, so every number in
 *  the detail table lines up under its column in the row above it. */
const ORDER_DETAIL_VARIANT_WIDTH = 120
const ORDER_DETAIL_COL = {
  product:
    ORDER_COL.expand +
    ORDER_COL.order +
    ORDER_COL.customer +
    ORDER_COL.date +
    ORDER_COL.status +
    ORDER_COL.channel -
    ORDER_DETAIL_VARIANT_WIDTH,
  variant: ORDER_DETAIL_VARIANT_WIDTH,
  qty: ORDER_COL.qty,
  gross: ORDER_COL.gross,
  discount: ORDER_COL.discount,
  net: ORDER_COL.net,
  cogs: ORDER_COL.cogs,
  fees: ORDER_COL.fees,
  shipping: ORDER_COL.shipping,
  refund: ORDER_COL.refund,
  profit: ORDER_COL.profit,
  margin: ORDER_COL.margin,
} as const

const ORDER_STICKY_LEFT = {
  order: ORDER_COL.expand,
  customer: ORDER_COL.expand + ORDER_COL.order,
}
const ORDER_STICKY_RIGHT = {
  profit: ORDER_COL.margin,
  margin: 0,
}

const orderThBase =
  'h-9 whitespace-nowrap px-3 align-middle text-xs font-medium uppercase tracking-wide text-neutral-500 bg-neutral-50'
const orderTdBase =
  'whitespace-nowrap px-3 align-middle text-sm text-neutral-900'
/** Tighter horizontal padding for the narrow Date/Qty columns — px-3 alone
 *  eats too much of their small fixed width, leaving no room for the digits. */
const orderThTight =
  'h-9 whitespace-nowrap px-2 align-middle text-xs font-medium uppercase tracking-wide text-neutral-500 bg-neutral-50'
const orderTdTight =
  'whitespace-nowrap px-2 align-middle text-sm text-neutral-900'
const orderStickyTh = 'sticky z-20'
const orderStickyTd = 'sticky z-10 bg-white group-hover:bg-neutral-50'
const orderEdgeRightShadow = 'shadow-[4px_0_6px_-4px_rgba(0,0,0,0.12)]'
const orderEdgeLeftShadow = 'shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.12)]'

function OrderProfitSection({
  result,
  page,
  pageSize,
  onPageChange,
  searchTerm,
  onSearchChange,
  status,
  onStatusChange,
}: {
  result: {
    orders: OrderProfitRow[]
    total: number
    totals: OrderProfitListTotals
  }
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  searchTerm: string
  onSearchChange: (search: string) => void
  status: OrderStatus | undefined
  onStatusChange: (status: OrderStatus | undefined) => void
}) {
  const totalPages = Math.max(1, Math.ceil(result.total / pageSize))
  const rangeStartIndex = result.total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEndIndex = Math.min(page * pageSize, result.total)
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(
    new Set(),
  )
  const [searchInput, setSearchInput] = useState(searchTerm)
  const debouncedSearchInput = useDebouncedValue(searchInput, 400)
  useEffect(() => {
    if (debouncedSearchInput !== searchTerm) {
      onSearchChange(debouncedSearchInput)
    }
    // Deliberately depends on debouncedSearchInput only — searchTerm and
    // onSearchChange both change as a result of this same effect firing
    // (a URL navigation), so including them would just re-run it in a loop.
  }, [debouncedSearchInput])
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
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Store Orders and Their Profit
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search order # or customer…"
            className={`${inputClassName} w-56`}
          />
          <select
            value={status ?? ''}
            onChange={(e) =>
              onStatusChange(
                (e.target.value || undefined) as OrderStatus | undefined,
              )
            }
            className={inputClassName}
          >
            <option value="">All Statuses</option>
            {(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
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
              <table
                className="table-fixed border-separate border-spacing-0"
                style={{ width: ORDER_TABLE_WIDTH }}
              >
                <colgroup>
                  {Object.values(ORDER_COL).map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th
                      className={`${orderThBase} ${orderStickyTh}`}
                      style={{ position: 'sticky', left: 0 }}
                    />
                    <th
                      className={`${orderThBase} ${orderStickyTh} text-left`}
                      style={{
                        position: 'sticky',
                        left: ORDER_STICKY_LEFT.order,
                      }}
                    >
                      Order
                    </th>
                    <th
                      className={`${orderThBase} ${orderStickyTh} ${orderEdgeRightShadow} text-left`}
                      style={{
                        position: 'sticky',
                        left: ORDER_STICKY_LEFT.customer,
                      }}
                    >
                      Customer
                    </th>
                    <th className={orderThTight}>Date</th>
                    <th className={orderThBase}>Status</th>
                    <th className={orderThBase}>Channel</th>
                    <th className={`${orderThTight} text-right`}>Qty</th>
                    <th className={`${orderThBase} text-right`}>Gross Sales</th>
                    <th className={`${orderThBase} text-right`}>Discount</th>
                    <th className={`${orderThBase} text-right`}>Net Sales</th>
                    <th className={`${orderThBase} text-right`}>COGS</th>
                    <th className={`${orderThBase} text-right`}>Fees</th>
                    <th className={`${orderThBase} text-right`}>Shipping</th>
                    <th className={`${orderThBase} text-right`}>Refund</th>
                    <th
                      className={`${orderThBase} ${orderStickyTh} ${orderEdgeLeftShadow} text-right`}
                      style={{
                        position: 'sticky',
                        right: ORDER_STICKY_RIGHT.profit,
                      }}
                    >
                      Profit
                    </th>
                    <th
                      className={`${orderThBase} ${orderStickyTh} text-right`}
                      style={{
                        position: 'sticky',
                        right: ORDER_STICKY_RIGHT.margin,
                      }}
                    >
                      Margin %
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.orders.map((order) => {
                    const isExpanded = expandedOrderIds.has(order.id)
                    const totalQty = order.items.reduce(
                      (sum, item) => sum + item.quantity,
                      0,
                    )
                    return (
                      <Fragment key={order.id}>
                        <tr className="group h-14 border-t border-neutral-100 first:border-t-0">
                          <td
                            className={`${orderTdBase} ${orderStickyTd}`}
                            style={{ position: 'sticky', left: 0 }}
                          >
                            {order.items.length > 0 && (
                              <button
                                type="button"
                                onClick={() => toggleExpanded(order.id)}
                                className="flex size-6 shrink-0 items-center justify-center text-neutral-400 hover:text-neutral-900"
                                aria-label={
                                  isExpanded ? 'Hide items' : 'Show items'
                                }
                              >
                                {isExpanded ? (
                                  <ChevronDown className="size-4" />
                                ) : (
                                  <ChevronRight className="size-4" />
                                )}
                              </button>
                            )}
                          </td>
                          <td
                            className={`${orderTdBase} ${orderStickyTd}`}
                            style={{
                              position: 'sticky',
                              left: ORDER_STICKY_LEFT.order,
                            }}
                          >
                            <Link
                              to="/admin/orders/$orderId"
                              params={{ orderId: order.id }}
                              className="font-medium text-neutral-900 hover:underline"
                            >
                              {order.orderNumber}
                            </Link>
                          </td>
                          <td
                            className={`${orderTdBase} ${orderStickyTd} ${orderEdgeRightShadow} truncate`}
                            style={{
                              position: 'sticky',
                              left: ORDER_STICKY_LEFT.customer,
                            }}
                            title={order.customerName}
                          >
                            {order.customerName}
                          </td>
                          <td
                            className={`${orderTdTight} tabular-nums text-neutral-500`}
                          >
                            {new Date(order.placedAt).toLocaleDateString(
                              'en-US',
                              {
                                month: '2-digit',
                                day: '2-digit',
                                year: '2-digit',
                              },
                            )}
                          </td>
                          <td className={orderTdBase}>
                            <StatusBadge status={order.status} kind="order" />
                          </td>
                          <td className={`${orderTdBase} text-neutral-500`}>
                            {SOURCE_LABELS[order.source]}
                          </td>
                          <td
                            className={`${orderTdTight} text-right tabular-nums text-neutral-500`}
                            title={`${order.items.length} ${order.items.length === 1 ? 'SKU' : 'SKUs'}`}
                          >
                            {totalQty}
                          </td>
                          <td
                            className={`${orderTdBase} text-right tabular-nums`}
                          >
                            {formatCentsAsPHP(order.grossSalesCents)}
                          </td>
                          <td
                            className={`${orderTdBase} text-right tabular-nums`}
                          >
                            {order.discountCents > 0
                              ? `-${formatCentsAsPHP(order.discountCents)}`
                              : '—'}
                          </td>
                          <td
                            className={`${orderTdBase} text-right tabular-nums`}
                          >
                            {formatCentsAsPHP(order.netSalesCents)}
                          </td>
                          <td
                            className={`${orderTdBase} text-right tabular-nums`}
                          >
                            {formatCentsAsPHP(order.costCents)}
                          </td>
                          <td
                            className={`${orderTdBase} text-right tabular-nums`}
                          >
                            {order.platformFeesCents > 0
                              ? formatCentsAsPHP(order.platformFeesCents)
                              : '—'}
                          </td>
                          <td
                            className={`${orderTdBase} text-right tabular-nums`}
                          >
                            {formatCentsAsPHP(order.shippingCents)}
                          </td>
                          <td
                            className={`${orderTdBase} text-right tabular-nums`}
                          >
                            {order.refundCents > 0
                              ? formatCentsAsPHP(order.refundCents)
                              : '—'}
                          </td>
                          <td
                            className={`${orderTdBase} ${orderStickyTd} ${orderEdgeLeftShadow} text-right tabular-nums font-semibold ${
                              order.profitCents >= 0
                                ? 'text-emerald-600'
                                : 'text-red-600'
                            }`}
                            style={{
                              position: 'sticky',
                              right: ORDER_STICKY_RIGHT.profit,
                            }}
                          >
                            {formatCentsAsPHP(order.profitCents)}
                          </td>
                          <td
                            className={`${orderTdBase} ${orderStickyTd} text-right tabular-nums`}
                            style={{
                              position: 'sticky',
                              right: ORDER_STICKY_RIGHT.margin,
                            }}
                          >
                            {order.marginPct !== null
                              ? `${order.marginPct.toFixed(1)}%`
                              : '—'}
                          </td>
                        </tr>
                        {isExpanded && order.items.length > 0 && (
                          <tr className="border-t border-neutral-100 bg-neutral-50/70">
                            <td colSpan={ORDER_COL_COUNT} className="py-3">
                              <table
                                className="table-fixed border-collapse text-xs"
                                style={{ width: ORDER_TABLE_WIDTH }}
                              >
                                <colgroup>
                                  {Object.values(ORDER_DETAIL_COL).map(
                                    (w, i) => (
                                      <col key={i} style={{ width: w }} />
                                    ),
                                  )}
                                </colgroup>
                                <thead>
                                  <tr className="text-neutral-400">
                                    <th className="px-2 py-1 text-left font-medium whitespace-nowrap">
                                      Product
                                    </th>
                                    <th className="px-2 py-1 text-left font-medium whitespace-nowrap">
                                      Variant
                                    </th>
                                    <th className="px-2 py-1 text-right font-medium whitespace-nowrap">
                                      Qty
                                    </th>
                                    <th className="px-2 py-1 text-right font-medium whitespace-nowrap">
                                      Gross Sales
                                    </th>
                                    <th className="px-2 py-1 text-right font-medium whitespace-nowrap">
                                      Discount
                                    </th>
                                    <th className="px-2 py-1 text-right font-medium whitespace-nowrap">
                                      Net Sales
                                    </th>
                                    <th className="px-2 py-1 text-right font-medium whitespace-nowrap">
                                      COGS
                                    </th>
                                    <th className="px-2 py-1 text-right font-medium whitespace-nowrap">
                                      Fees
                                    </th>
                                    <th className="px-2 py-1 text-right font-medium whitespace-nowrap">
                                      Shipping
                                    </th>
                                    <th className="px-2 py-1 text-right font-medium whitespace-nowrap">
                                      Refund
                                    </th>
                                    <th className="px-2 py-1 text-right font-medium whitespace-nowrap">
                                      Profit
                                    </th>
                                    <th className="px-2 py-1 text-right font-medium whitespace-nowrap">
                                      Margin
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {order.items.map((item, index) => (
                                    <tr
                                      key={index}
                                      className="border-t border-neutral-200/70 text-neutral-600"
                                    >
                                      <td
                                        className="truncate px-2 py-1.5"
                                        title={item.productName}
                                      >
                                        {item.productName}
                                      </td>
                                      <td className="whitespace-nowrap px-2 py-1.5 text-neutral-400">
                                        {item.variantLabel ?? '—'}
                                      </td>
                                      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                                        {item.quantity}
                                      </td>
                                      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                                        {formatCentsAsPHP(item.lineTotalCents)}
                                      </td>
                                      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                                        {item.discountCents > 0
                                          ? `-${formatCentsAsPHP(item.discountCents)}`
                                          : '—'}
                                      </td>
                                      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                                        {formatCentsAsPHP(item.netSalesCents)}
                                      </td>
                                      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                                        {formatCentsAsPHP(item.costCents)}
                                      </td>
                                      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                                        {item.platformFeesCents > 0
                                          ? formatCentsAsPHP(
                                              item.platformFeesCents,
                                            )
                                          : '—'}
                                      </td>
                                      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                                        {item.shippingCents > 0
                                          ? formatCentsAsPHP(item.shippingCents)
                                          : '—'}
                                      </td>
                                      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                                        {item.refundCents > 0
                                          ? formatCentsAsPHP(item.refundCents)
                                          : '—'}
                                      </td>
                                      <td
                                        className={`px-2 py-1.5 text-right tabular-nums font-semibold ${
                                          item.profitCents >= 0
                                            ? 'text-emerald-600'
                                            : 'text-red-600'
                                        }`}
                                      >
                                        {formatCentsAsPHP(item.profitCents)}
                                      </td>
                                      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                                        {item.marginPct !== null
                                          ? `${item.marginPct.toFixed(1)}%`
                                          : '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t border-neutral-300 font-semibold text-neutral-700">
                                    <td
                                      className="whitespace-nowrap px-2 py-1.5"
                                      colSpan={2}
                                    >
                                      Order Total
                                    </td>
                                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                                      {totalQty}
                                    </td>
                                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                                      {formatCentsAsPHP(order.grossSalesCents)}
                                    </td>
                                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                                      {order.discountCents > 0
                                        ? `-${formatCentsAsPHP(order.discountCents)}`
                                        : '—'}
                                    </td>
                                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                                      {formatCentsAsPHP(order.netSalesCents)}
                                    </td>
                                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                                      {formatCentsAsPHP(order.costCents)}
                                    </td>
                                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                                      {order.platformFeesCents > 0
                                        ? formatCentsAsPHP(
                                            order.platformFeesCents,
                                          )
                                        : '—'}
                                    </td>
                                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                                      {formatCentsAsPHP(order.shippingCents)}
                                    </td>
                                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                                      {order.refundCents > 0
                                        ? formatCentsAsPHP(order.refundCents)
                                        : '—'}
                                    </td>
                                    <td
                                      className={`px-2 py-1.5 text-right tabular-nums ${
                                        order.profitCents >= 0
                                          ? 'text-emerald-600'
                                          : 'text-red-600'
                                      }`}
                                    >
                                      {formatCentsAsPHP(order.profitCents)}
                                    </td>
                                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                                      {order.marginPct !== null
                                        ? `${order.marginPct.toFixed(1)}%`
                                        : '—'}
                                    </td>
                                  </tr>
                                </tfoot>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="h-11 border-t-2 border-neutral-300 bg-neutral-100 text-xs font-semibold text-neutral-900">
                    <td
                      className={`${orderTdBase} sticky z-10 bg-neutral-100`}
                      style={{ position: 'sticky', left: 0 }}
                    />
                    <td
                      className={`${orderTdBase} sticky z-10 bg-neutral-100`}
                      style={{
                        position: 'sticky',
                        left: ORDER_STICKY_LEFT.order,
                      }}
                    />
                    <td
                      className={`${orderTdBase} sticky z-10 bg-neutral-100 ${orderEdgeRightShadow}`}
                      style={{
                        position: 'sticky',
                        left: ORDER_STICKY_LEFT.customer,
                      }}
                    >
                      Totals ({result.total}{' '}
                      {result.total === 1 ? 'order' : 'orders'})
                    </td>
                    <td className={orderTdBase} />
                    <td className={orderTdBase} />
                    <td className={orderTdBase} />
                    <td className={`${orderTdBase} text-right`} />
                    <td className={`${orderTdBase} text-right tabular-nums`}>
                      {formatCentsAsPHP(result.totals.grossSalesCents)}
                    </td>
                    <td className={`${orderTdBase} text-right tabular-nums`}>
                      {result.totals.discountCents > 0
                        ? `-${formatCentsAsPHP(result.totals.discountCents)}`
                        : '—'}
                    </td>
                    <td className={`${orderTdBase} text-right tabular-nums`}>
                      {formatCentsAsPHP(result.totals.netSalesCents)}
                    </td>
                    <td className={`${orderTdBase} text-right tabular-nums`}>
                      {formatCentsAsPHP(result.totals.costCents)}
                    </td>
                    <td className={`${orderTdBase} text-right tabular-nums`}>
                      {result.totals.platformFeesCents > 0
                        ? formatCentsAsPHP(result.totals.platformFeesCents)
                        : '—'}
                    </td>
                    <td className={`${orderTdBase} text-right tabular-nums`}>
                      {formatCentsAsPHP(result.totals.shippingCents)}
                    </td>
                    <td className={`${orderTdBase} text-right tabular-nums`}>
                      {result.totals.refundCents > 0
                        ? formatCentsAsPHP(result.totals.refundCents)
                        : '—'}
                    </td>
                    <td
                      className={`${orderTdBase} sticky z-10 bg-neutral-100 ${orderEdgeLeftShadow} text-right tabular-nums ${
                        result.totals.profitCents >= 0
                          ? 'text-emerald-600'
                          : 'text-red-600'
                      }`}
                      style={{
                        position: 'sticky',
                        right: ORDER_STICKY_RIGHT.profit,
                      }}
                    >
                      {formatCentsAsPHP(result.totals.profitCents)}
                    </td>
                    <td
                      className={`${orderTdBase} sticky z-10 bg-neutral-100 text-right tabular-nums`}
                      style={{
                        position: 'sticky',
                        right: ORDER_STICKY_RIGHT.margin,
                      }}
                    >
                      {result.totals.marginPct !== null
                        ? `${result.totals.marginPct.toFixed(1)}%`
                        : '—'}
                    </td>
                  </tr>
                </tfoot>
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

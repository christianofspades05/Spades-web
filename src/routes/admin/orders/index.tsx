import { useEffect, useState } from 'react'
import { z } from 'zod'
import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { Search } from 'lucide-react'
import {
  bulkCancelOrders,
  getOrdersCount,
  getOrdersOverview,
  listOrders,
} from '#/server/admin/orders'
import type { OrderWithCustomer, OrdersOverview } from '#/server/admin/orders'
import type { OrderSource } from '#/types/entities'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import {
  DATE_RANGE_PRESETS,
  percentChange,
  resolveDateRange,
} from '#/lib/utils/date-range'
import type { DateRangePreset } from '#/lib/utils/date-range'
import { shippingZoneForRegion } from '#/lib/checkout/shipping'
import type { ShippingZone } from '#/lib/checkout/shipping'
import { PageHeader } from '#/components/admin/PageHeader'
import { Card } from '#/components/admin/Card'
import { Badge, StatusBadge } from '#/components/admin/Badge'
import { DateRangePicker } from '#/components/admin/DateRangePicker'
import { FilterDropdown } from '#/components/admin/FilterDropdown'
import { SparkLine } from '#/components/admin/LineChart'
import { OrderCard } from '#/components/admin/OrderCard'
import {
  buttonSecondaryClassName,
  inputClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

// Tighter vertical padding than the shared tableCellClassName, scoped to
// this page only — this table has a lot of rows and staff want more of
// them visible without scrolling.
const tableCellClassName = 'px-4 py-1.5 text-sm text-neutral-900'

const PAGE_SIZE = 50

const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'processing',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
  'failed',
] as const

const SOURCE_LABELS: Record<OrderSource, string> = {
  storefront: 'Online Store',
  admin: 'Admin (manual)',
  tiktok_shop: 'TikTok Shop',
  shopee: 'Shopee',
  lazada: 'Lazada',
}

const PAYMENT_STATUS_OPTIONS = [
  { value: 'pending_payment', label: 'Pending Payment' },
  { value: 'paid', label: 'Paid' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

const FULFILLMENT_STATUS_OPTIONS = [
  { value: 'fulfilled', label: 'Fulfilled' },
  { value: 'unfulfilled', label: 'Unfulfilled' },
  { value: 'pending', label: 'Awaiting Shipment' },
  { value: 'packed', label: 'Awaiting Collection' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'delivered', label: 'Delivered' },
] as const

const CHANNEL_OPTIONS = [
  { value: 'storefront', label: 'Online Store' },
  { value: 'tiktok_shop', label: 'TikTok Shop' },
  { value: 'shopee', label: 'Shopee' },
  { value: 'lazada', label: 'Lazada' },
] as const

type CancellationReason =
  'failed_delivery' | 'customer_request' | 'out_of_stock'

const CANCELLATION_REASON_LABELS: Record<CancellationReason, string> = {
  failed_delivery: 'Failed delivery',
  customer_request: 'Customer request',
  out_of_stock: 'Out of stock',
}

const ZONE_LABELS: Record<ShippingZone, string> = {
  metro_manila: 'Metro Manila',
  luzon: 'Luzon Provinces',
  visayas: 'Visayas',
  mindanao: 'Mindanao',
}

interface OrderShippingAddress {
  region: string
  [key: string]: unknown
}

export const Route = createFileRoute('/admin/orders/')({
  validateSearch: z.object({
    status: z.enum(ORDER_STATUSES).optional(),
    source: z
      .enum(['storefront', 'admin', 'tiktok_shop', 'shopee', 'lazada'])
      .optional(),
    fulfillment: z
      .enum([
        'unfulfilled',
        'fulfilled',
        'pending',
        'packed',
        'in_transit',
        'delivered',
      ])
      .optional(),
    q: z.string().optional(),
    page: z.number().int().min(1).catch(1),
    range: z.enum(DATE_RANGE_PRESETS).catch('today'),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const resolved = resolveDateRange(deps.range, {
      from: deps.from,
      to: deps.to,
    })
    const filters = {
      status: deps.status,
      source: deps.source,
      fulfillment: deps.fulfillment,
      q: deps.q,
    }
    const overviewPromise: Promise<OrdersOverview> = getOrdersOverview({
      data: resolved,
    })
    const [orders, { total }, overview] = await Promise.all([
      listOrders({
        data: { ...filters, page: deps.page, pageSize: PAGE_SIZE },
      }),
      getOrdersCount({ data: filters }),
      overviewPromise,
    ])
    return { orders, total, overview }
  },
  component: OrdersPage,
})

function OrdersPage() {
  const {
    orders,
    total,
    overview,
  }: { orders: OrderWithCustomer[]; total: number; overview: OrdersOverview } =
    Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()
  const [searchInput, setSearchInput] = useState(search.q ?? '')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openItemsFor, setOpenItemsFor] = useState<string | null>(null)
  const [bulkRestock, setBulkRestock] = useState(true)
  const [bulkReason, setBulkReason] = useState<CancellationReason | ''>('')
  const [bulkCancelling, setBulkCancelling] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)

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

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault()
    navigate({
      search: (prev) => ({ ...prev, q: searchInput || undefined, page: 1 }),
    })
  }

  // Debounced live search — navigates 300ms after the user stops typing
  // instead of firing a query on every keystroke. The explicit submit above
  // still works for an immediate Enter press.
  useEffect(() => {
    const trimmed = searchInput.trim()
    if (trimmed === (search.q ?? '')) return
    const handle = setTimeout(() => {
      navigate({
        search: (prev) => ({ ...prev, q: trimmed || undefined, page: 1 }),
      })
    }, 300)
    return () => clearTimeout(handle)
  }, [searchInput])

  function toggleAll() {
    setSelected((prev) =>
      prev.size === orders.length
        ? new Set()
        : new Set(orders.map((o) => o.id)),
    )
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleBulkCancel() {
    if (selected.size === 0) return
    if (!bulkReason) {
      setBulkError('Please select a reason for cancelling.')
      return
    }
    if (
      !confirm(
        `Cancel ${selected.size} order${selected.size === 1 ? '' : 's'}? This can't be undone.`,
      )
    ) {
      return
    }
    setBulkCancelling(true)
    setBulkError(null)
    try {
      const result = await bulkCancelOrders({
        data: {
          orderIds: Array.from(selected),
          restock: bulkRestock,
          reason: bulkReason,
        },
      })
      if (result.skipped > 0) {
        setBulkError(
          `${result.cancelled} cancelled, ${result.skipped} skipped (already past a cancellable status).`,
        )
      }
      setSelected(new Set())
      router.invalidate()
    } catch (err) {
      setBulkError(getErrorMessage(err))
    } finally {
      setBulkCancelling(false)
    }
  }

  const page = search.page
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rangeStartIndex = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEndIndex = Math.min(page * PAGE_SIZE, total)

  const avgFulfillment =
    overview.avgFulfillmentHours === null
      ? '—'
      : overview.avgFulfillmentHours < 24
        ? `${overview.avgFulfillmentHours.toFixed(1)} hrs`
        : `${(overview.avgFulfillmentHours / 24).toFixed(1)} days`

  const statCards = [
    {
      label: 'Orders',
      value: overview.orders.count,
      trend: percentChange(
        overview.orders.count,
        overview.orders.previousCount,
      ),
      spark: overview.orders.daily,
    },
    {
      label: 'Items ordered',
      value: overview.itemsOrdered.count,
      trend: percentChange(
        overview.itemsOrdered.count,
        overview.itemsOrdered.previousCount,
      ),
    },
    {
      label: 'Returns',
      value: overview.returns.count,
      trend: percentChange(
        overview.returns.count,
        overview.returns.previousCount,
      ),
    },
    {
      label: 'Orders fulfilled',
      value: overview.fulfilled.count,
      trend: percentChange(
        overview.fulfilled.count,
        overview.fulfilled.previousCount,
      ),
    },
    {
      label: 'Orders delivered',
      value: overview.delivered.count,
      trend: percentChange(
        overview.delivered.count,
        overview.delivered.previousCount,
      ),
    },
    { label: 'Avg. time to fulfillment', value: avgFulfillment },
  ]

  return (
    <div className="w-full px-8 py-10">
      <PageHeader
        title="Orders"
        subtitle={`${total} ${total === 1 ? 'order' : 'orders'}`}
        action={
          <DateRangePicker
            preset={search.range}
            from={overview.range.from}
            to={overview.range.to}
            onChange={handleRangeChange}
          />
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {statCards.map((stat) => (
          <Card key={stat.label} className="p-3.5">
            <p className="text-xs font-medium text-neutral-500">{stat.label}</p>
            <div className="mt-1 flex items-end justify-between gap-2">
              <p className="text-xl font-semibold text-neutral-900">
                {stat.value}
              </p>
              {typeof stat.trend === 'number' && (
                <TrendTag value={stat.trend} />
              )}
            </div>
            {stat.spark && stat.spark.length > 1 && (
              <div className="mt-1.5">
                <SparkLine
                  values={stat.spark}
                  tone={
                    typeof stat.trend === 'number' && stat.trend !== 0
                      ? stat.trend > 0
                        ? 'positive'
                        : 'negative'
                      : 'neutral'
                  }
                />
              </div>
            )}
          </Card>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <form onSubmit={handleSearchSubmit} className="w-full max-w-xs">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-neutral-400"
            />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search orders or customers"
              className={`${inputClassName} w-full pl-8`}
            />
          </div>
        </form>

        <div className="flex flex-wrap gap-2">
          <FilterDropdown
            label="Payment"
            value={search.status}
            options={PAYMENT_STATUS_OPTIONS}
            onChange={(status) =>
              navigate({ search: (prev) => ({ ...prev, status, page: 1 }) })
            }
          />
          <FilterDropdown
            label="Fulfillment Status"
            value={search.fulfillment}
            options={FULFILLMENT_STATUS_OPTIONS}
            onChange={(fulfillment) =>
              navigate({
                search: (prev) => ({ ...prev, fulfillment, page: 1 }),
              })
            }
          />
          <FilterDropdown
            label="Channel"
            value={search.source}
            options={CHANNEL_OPTIONS}
            onChange={(source) =>
              navigate({ search: (prev) => ({ ...prev, source, page: 1 }) })
            }
          />
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2.5">
          <span className="text-sm font-medium text-neutral-700">
            {selected.size} selected
          </span>
          <Link
            to="/admin/orders/bulk-fulfill"
            search={{ ids: Array.from(selected).join(',') }}
            className={buttonSecondaryClassName}
          >
            Mark selected as fulfilled
          </Link>
          <span className="h-4 w-px bg-neutral-300" />
          <label className="flex items-center gap-1.5 text-sm text-neutral-600">
            <input
              type="checkbox"
              checked={bulkRestock}
              onChange={(e) => setBulkRestock(e.target.checked)}
            />
            Restock inventory
          </label>
          <select
            value={bulkReason}
            onChange={(e) =>
              setBulkReason(e.target.value as CancellationReason | '')
            }
            className={`${inputClassName} w-auto`}
          >
            <option value="">Reason for cancellation…</option>
            {(
              Object.keys(CANCELLATION_REASON_LABELS) as CancellationReason[]
            ).map((r) => (
              <option key={r} value={r}>
                {CANCELLATION_REASON_LABELS[r]}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={bulkCancelling || !bulkReason}
            onClick={handleBulkCancel}
            className={buttonSecondaryClassName}
          >
            {bulkCancelling ? 'Cancelling…' : 'Cancel selected orders'}
          </button>
          {bulkError && (
            <span className="text-sm text-red-600">{bulkError}</span>
          )}
        </div>
      )}

      {orders.length === 0 && (
        <p className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
          No orders found.
        </p>
      )}

      {orders.length > 0 && (
        <div className="flex flex-col gap-3 md:hidden">
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              checked={selected.has(order.id)}
              onToggle={() => toggleOne(order.id)}
              onOpen={() =>
                navigate({
                  to: '/admin/orders/$orderId',
                  params: { orderId: order.id },
                })
              }
            />
          ))}
        </div>
      )}

      <div className={`${tableWrapperClassName} hidden md:block`}>
        {orders.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">No orders found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={`${tableHeadClassName} w-8`}>
                    <input
                      type="checkbox"
                      checked={selected.size === orders.length}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className={`${tableHeadClassName} w-24`}>Order</th>
                  <th className={`${tableHeadClassName} w-28`}>Date</th>
                  <th className={tableHeadClassName}>Customer</th>
                  <th className={tableHeadClassName}>Channel</th>
                  <th className={`${tableHeadClassName} text-right`}>Total</th>
                  <th className={tableHeadClassName}>Payment status</th>
                  <th className={tableHeadClassName}>Fulfillment status</th>
                  <th className={`${tableHeadClassName} text-right`}>Items</th>
                  <th className={tableHeadClassName}>Delivery status</th>
                  <th className={tableHeadClassName}>Delivery method</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const latestPayment = [...order.payments]
                    .sort((a, b) => b.created_at.localeCompare(a.created_at))
                    .at(0)
                  const shipment = order.shipments.at(0)
                  const itemCount = order.order_items.reduce(
                    (sum, i) => sum + i.quantity,
                    0,
                  )
                  const address =
                    order.shipping_address as unknown as OrderShippingAddress
                  const zone =
                    ZONE_LABELS[shippingZoneForRegion(address.region)]
                  const isOpen = openItemsFor === order.id

                  return (
                    <tr
                      key={order.id}
                      onClick={() =>
                        navigate({
                          to: '/admin/orders/$orderId',
                          params: { orderId: order.id },
                        })
                      }
                      className={
                        order.status === 'cancelled'
                          ? `${tableRowClassName} cursor-pointer opacity-60 line-through decoration-2`
                          : `${tableRowClassName} cursor-pointer`
                      }
                    >
                      <td
                        className={tableCellClassName}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(order.id)}
                          onChange={() => toggleOne(order.id)}
                        />
                      </td>
                      <td className={tableCellClassName}>
                        <Link
                          to="/admin/orders/$orderId"
                          params={{ orderId: order.id }}
                          className="font-medium text-neutral-900 hover:underline"
                        >
                          {order.order_number}
                        </Link>
                      </td>
                      <td
                        className={`${tableCellClassName} text-neutral-500 whitespace-nowrap`}
                      >
                        <p>
                          {new Date(order.placed_at).toLocaleDateString(
                            'en-US',
                            { month: 'short', day: 'numeric' },
                          )}
                        </p>
                        <p className="text-xs text-neutral-400">
                          {new Date(order.placed_at).toLocaleTimeString(
                            'en-US',
                            { hour: 'numeric', minute: '2-digit' },
                          )}
                        </p>
                      </td>
                      <td className={`${tableCellClassName} text-neutral-500`}>
                        {order.customer.full_name ?? order.customer.email}
                      </td>
                      <td className={`${tableCellClassName} text-neutral-500`}>
                        <p>{SOURCE_LABELS[order.source]}</p>
                        {order.external_order_id && (
                          <p className="text-xs text-neutral-400">
                            {order.external_order_id}
                          </p>
                        )}
                      </td>
                      <td
                        className={`${tableCellClassName} text-right font-medium`}
                      >
                        {formatCentsAsPHP(order.total_cents)}
                      </td>
                      <td className={tableCellClassName}>
                        {order.is_cod ? (
                          <Badge tone="neutral">Cash on Delivery</Badge>
                        ) : latestPayment ? (
                          <StatusBadge
                            status={latestPayment.status}
                            kind="payment"
                          />
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className={tableCellClassName}>
                        {order.status === 'cancelled' &&
                        order.cancellation_reason &&
                        order.cancellation_reason in
                          CANCELLATION_REASON_LABELS ? (
                          <Badge tone="critical">
                            {
                              CANCELLATION_REASON_LABELS[
                                order.cancellation_reason as CancellationReason
                              ]
                            }
                          </Badge>
                        ) : (
                          <StatusBadge
                            status={shipment?.status ?? 'unfulfilled'}
                            kind="shipment"
                          />
                        )}
                      </td>
                      <td
                        className={`${tableCellClassName} relative text-right`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setOpenItemsFor(isOpen ? null : order.id)
                          }
                          className="text-neutral-700 underline decoration-dotted hover:text-neutral-950"
                        >
                          {itemCount}
                        </button>
                        {isOpen && (
                          <>
                            <button
                              type="button"
                              aria-label="Close"
                              onClick={() => setOpenItemsFor(null)}
                              className="fixed inset-0 z-10 cursor-default"
                            />
                            <div className="absolute top-full right-0 z-20 mt-1 w-80 rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-lg">
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                Items in {order.order_number}
                              </p>
                              <ul className="flex flex-col divide-y divide-neutral-100">
                                {order.order_items.map((item) => (
                                  <li
                                    key={item.id}
                                    className="flex items-center gap-2.5 py-1.5 text-sm"
                                  >
                                    {item.image_url ? (
                                      <img
                                        src={item.image_url}
                                        alt=""
                                        className="h-10 w-10 shrink-0 rounded-md border border-neutral-200 object-cover"
                                      />
                                    ) : (
                                      <div className="h-10 w-10 shrink-0 rounded-md border border-neutral-200 bg-neutral-50" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate font-medium text-neutral-900">
                                        {item.product_name_snapshot}
                                        {!item.variant_id && (
                                          <span className="ml-1 font-normal text-amber-600">
                                            (Not Connected)
                                          </span>
                                        )}
                                      </p>
                                      <div className="flex items-center justify-between text-neutral-500">
                                        <span>
                                          {item.variant_label_snapshot ?? '—'}
                                        </span>
                                        <span>× {item.quantity}</span>
                                      </div>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </>
                        )}
                      </td>
                      <td className={tableCellClassName}>
                        {shipment?.tracking_number ?? (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className={`${tableCellClassName} text-neutral-500`}>
                        {zone}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm text-neutral-500">
          <p>
            Showing {rangeStartIndex}–{rangeEndIndex} of {total}
          </p>
          <div className="flex items-center gap-2">
            <Link
              to="/admin/orders"
              from={Route.fullPath}
              search={(prev) => ({ ...prev, page: page - 1 })}
              aria-disabled={page <= 1}
              className={`${buttonSecondaryClassName} ${page <= 1 ? 'pointer-events-none opacity-40' : ''}`}
            >
              Previous
            </Link>
            <span className="text-xs text-neutral-400">
              Page {page} of {totalPages}
            </span>
            <Link
              to="/admin/orders"
              from={Route.fullPath}
              search={(prev) => ({ ...prev, page: page + 1 })}
              aria-disabled={page >= totalPages}
              className={`${buttonSecondaryClassName} ${page >= totalPages ? 'pointer-events-none opacity-40' : ''}`}
            >
              Next
            </Link>
          </div>
        </div>
      )}
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
      className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${colorClass}`}
    >
      {value > 0 ? '+' : ''}
      {value}%
    </span>
  )
}

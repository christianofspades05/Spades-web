import { useState } from 'react'
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
  getOrdersOverview,
  listOrders,
} from '#/server/admin/orders'
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
import { SparkLine } from '#/components/admin/LineChart'
import {
  buttonSecondaryClassName,
  inputClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

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
    q: z.string().optional(),
    range: z.enum(DATE_RANGE_PRESETS).catch('last_30_days'),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const resolved = resolveDateRange(deps.range, {
      from: deps.from,
      to: deps.to,
    })
    const [orders, overview] = await Promise.all([
      listOrders({
        data: { status: deps.status, source: deps.source, q: deps.q },
      }),
      getOrdersOverview({ data: resolved }),
    ])
    return { orders, overview }
  },
  component: OrdersPage,
})

function OrdersPage() {
  const { orders, overview } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()
  const [searchInput, setSearchInput] = useState(search.q ?? '')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openItemsFor, setOpenItemsFor] = useState<string | null>(null)
  const [bulkRestock, setBulkRestock] = useState(true)
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
      search: (prev) => ({ ...prev, q: searchInput || undefined }),
    })
  }

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
        data: { orderIds: Array.from(selected), restock: bulkRestock },
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
        subtitle={`${orders.length} ${orders.length === 1 ? 'order' : 'orders'}`}
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
          <Link
            to="/admin/orders"
            search={(prev) => ({ ...prev, status: undefined })}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              !search.status
                ? 'bg-neutral-900 text-white'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            }`}
          >
            All
          </Link>
          {ORDER_STATUSES.map((s) => (
            <Link
              key={s}
              to="/admin/orders"
              search={(prev) => ({ ...prev, status: s })}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
                search.status === s
                  ? 'bg-neutral-900 text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
            >
              {s.replace(/_/g, ' ')}
            </Link>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
          Channel
        </span>
        <Link
          to="/admin/orders"
          search={(prev) => ({ ...prev, source: undefined })}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            !search.source
              ? 'bg-neutral-900 text-white'
              : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
          }`}
        >
          All
        </Link>
        {(Object.keys(SOURCE_LABELS) as OrderSource[]).map((s) => (
          <Link
            key={s}
            to="/admin/orders"
            search={(prev) => ({ ...prev, source: s })}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              search.source === s
                ? 'bg-neutral-900 text-white'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            }`}
          >
            {SOURCE_LABELS[s]}
          </Link>
        ))}
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
          <button
            type="button"
            disabled={bulkCancelling}
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

      <div className={tableWrapperClassName}>
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
                  const latestPayment = [...order.payments].sort((a, b) =>
                    b.created_at.localeCompare(a.created_at),
                  )[0]
                  const shipment = order.shipments[0]
                  const isFulfilled =
                    !!shipment &&
                    [
                      'packed',
                      'in_transit',
                      'out_for_delivery',
                      'delivered',
                    ].includes(shipment.status)
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
                        <StatusBadge
                          status={isFulfilled ? 'fulfilled' : 'unfulfilled'}
                          kind="shipment"
                        />
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

import { useState } from 'react'
import {
  createFileRoute,
  Link,
  notFound,
  useRouter,
} from '@tanstack/react-router'
import {
  cancelOrder,
  getOrderById,
  updateOrderStatus,
  upsertShipment,
} from '#/server/admin/orders'
import type { OrderWithDetails } from '#/server/admin/orders'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import { formatShippingAddress } from '#/lib/checkout/shipping-address'
import type { OrderShippingAddress } from '#/lib/checkout/shipping-address'
import { formatOrderItemsForCopy } from '#/lib/utils/order-items-text'
import { PageHeader } from '#/components/admin/PageHeader'
import { Card } from '#/components/admin/Card'
import { StatusBadge } from '#/components/admin/Badge'
import { CopyButton } from '#/components/admin/CopyButton'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/admin/ui'
import type {
  OrderCancellationReason,
  OrderSource,
  OrderStatus,
  ReturnStatus,
  ShipmentStatus,
} from '#/types/entities'

// Covers all 4 reasons (including platform_cancelled, for marketplace-synced
// cancellations) since this displays whatever an already-cancelled order's
// reason actually is. Distinct from the narrower CANCELLATION_REASON_LABELS
// below, which only powers the manual-cancel dialog's dropdown — staff can't
// pick "cancelled on marketplace" as a reason themselves.
const ALL_CANCELLATION_REASON_LABELS: Record<OrderCancellationReason, string> = {
  failed_delivery: 'Failed Delivery',
  customer_request: 'Customer Request',
  out_of_stock: 'Out of Stock',
  platform_cancelled: 'Cancelled on Marketplace',
}

const SOURCE_LABELS: Record<OrderSource, string> = {
  storefront: 'Online Store',
  admin: 'Admin (manual)',
  tiktok_shop: 'TikTok Shop',
  shopee: 'Shopee',
  lazada: 'Lazada',
}

const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  requested: 'Requested',
  approved: 'Approved — awaiting item',
  received: 'Item received',
  refunded: 'Refunded',
  rejected: 'Rejected / cancelled',
}

// Mirrors ALLOWED_TRANSITIONS in src/server/admin/orders.ts — that map is the
// enforced source of truth; this one only limits the dropdown's options.
// 'cancelled' is deliberately left out here — cancelling has its own panel
// (with the restock choice) below instead of living in this dropdown.
const NEXT_STATUSES: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['paid', 'failed'],
  paid: ['processing', 'refunded'],
  processing: ['packed'],
  packed: ['shipped'],
  shipped: ['delivered'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
  failed: [],
}

const CANCELLABLE_STATUSES = new Set<OrderStatus>([
  'pending_payment',
  'paid',
  'processing',
  'packed',
])

type CancellationReason =
  'failed_delivery' | 'customer_request' | 'out_of_stock'

const CANCELLATION_REASON_LABELS: Record<CancellationReason, string> = {
  failed_delivery: 'Failed delivery',
  customer_request: 'Customer request',
  out_of_stock: 'Out of stock',
}

const SHIPMENT_STATUSES: ShipmentStatus[] = [
  'in_transit',
  'out_for_delivery',
  'delivered',
  'failed',
  'returned_to_sender',
]

export const Route = createFileRoute('/admin/orders/$orderId')({
  loader: async ({ params }) => {
    const order = await getOrderById({ data: { id: params.orderId } })
    if (!order) throw notFound()
    return order
  },
  component: OrderDetailPage,
})

function OrderDetailPage() {
  const order: OrderWithDetails = Route.useLoaderData()
  const router = useRouter()
  const address = order.shipping_address as unknown as OrderShippingAddress
  const fullAddress = formatShippingAddress(address)
  const itemsCopyText = formatOrderItemsForCopy(order.order_items)
  const isCancelled = order.status === 'cancelled'

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title={order.order_number}
        subtitle={order.customer.email}
        action={<StatusBadge status={order.status} kind="order" />}
      />

      {isCancelled && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
          This order was cancelled
          {order.cancellation_reason &&
            ` (${ALL_CANCELLATION_REASON_LABELS[order.cancellation_reason]})`}
          {order.cancelled_at &&
            ` on ${new Date(order.cancelled_at).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}`}
          .
          {order.cancellation_detail && (
            <span className="mt-1 block font-normal text-red-700">
              {order.source === 'storefront' || order.source === 'admin'
                ? order.cancellation_detail
                : `${SOURCE_LABELS[order.source]} says: "${order.cancellation_detail}"`}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card className={isCancelled ? 'p-5 opacity-60' : 'p-5'}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
                Items
              </h2>
              <CopyButton value={itemsCopyText} label="Copy items" />
            </div>
            <div className={isCancelled ? 'line-through decoration-2' : ''}>
              <ul className="flex flex-col divide-y divide-neutral-100">
                {order.order_items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 py-3 text-sm"
                  >
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt=""
                        className="h-14 w-14 shrink-0 rounded-md border border-neutral-200 object-cover"
                      />
                    ) : (
                      <div className="h-14 w-14 shrink-0 rounded-md border border-neutral-200 bg-neutral-50" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-neutral-900 underline decoration-neutral-300 underline-offset-2 md:no-underline">
                        {item.product_name_snapshot}
                      </p>
                      {item.variant_label_snapshot && (
                        <p className="text-neutral-500">
                          {item.variant_label_snapshot}
                        </p>
                      )}
                      <p className="text-neutral-500">
                        {item.quantity} ×{' '}
                        {formatCentsAsPHP(item.unit_price_cents)}
                      </p>
                    </div>
                    <p className="font-medium text-neutral-900">
                      {formatCentsAsPHP(item.line_total_cents)}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-col gap-1 border-t border-neutral-100 pt-3 text-sm">
                <div className="flex justify-between text-neutral-500">
                  <span>Subtotal</span>
                  <span>{formatCentsAsPHP(order.subtotal_cents)}</span>
                </div>
                {order.discount_cents > 0 && (
                  <div className="flex justify-between text-neutral-500">
                    <span>Discount</span>
                    <span>-{formatCentsAsPHP(order.discount_cents)}</span>
                  </div>
                )}
                <div className="flex justify-between text-neutral-500">
                  <span>Shipping</span>
                  <span>{formatCentsAsPHP(order.shipping_cents)}</span>
                </div>
                <div className="flex justify-between font-semibold text-neutral-900">
                  <span>Total</span>
                  <span>{formatCentsAsPHP(order.total_cents)}</span>
                </div>
              </div>
            </div>
          </Card>

          {order.returns.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                Returns
              </h2>
              <ul className="flex flex-col divide-y divide-neutral-100">
                {order.returns.map((ret) => (
                  <li key={ret.id} className="flex flex-col gap-1 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-neutral-900">
                        {RETURN_STATUS_LABELS[ret.status]}
                      </span>
                      <span className="text-neutral-500">
                        {new Date(ret.requested_at).toLocaleDateString(
                          'en-US',
                          { month: 'long', day: 'numeric', year: 'numeric' },
                        )}
                      </span>
                    </div>
                    <p className="text-neutral-600">
                      {ret.quantity} item{ret.quantity === 1 ? '' : 's'} —{' '}
                      {ret.reason}
                    </p>
                    {ret.refund_amount_cents !== null && (
                      <p className="text-neutral-500">
                        Refund: {formatCentsAsPHP(ret.refund_amount_cents)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <ShipmentForm
            orderId={order.id}
            shipment={order.shipments[0] ?? null}
            onSaved={() => router.invalidate()}
          />

          <StatusForm
            orderId={order.id}
            status={order.status}
            onSaved={() => router.invalidate()}
          />

          <CancelOrderPanel
            orderId={order.id}
            status={order.status}
            onCancelled={() => router.invalidate()}
          />
        </div>

        <div className="flex flex-col gap-6">
          {order.external_order_id && (
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                Channel
              </h2>
              <div className="flex flex-col gap-2 text-sm text-neutral-700">
                <p className="font-medium text-neutral-900">
                  {SOURCE_LABELS[order.source]}
                </p>
                <Row label={order.external_order_id}>
                  <CopyButton
                    value={order.external_order_id}
                    label="Copy order ID"
                    iconOnly
                  />
                </Row>
              </div>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Customer
            </h2>
            <Link
              to="/admin/customers/$customerId"
              params={{ customerId: order.customer.id }}
              className="text-sm font-medium text-neutral-900 hover:underline"
            >
              {order.customer.full_name ?? order.customer.email}
            </Link>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-neutral-500">
              <Link
                to="/admin/customers/$customerId"
                params={{ customerId: order.customer.id }}
                className="hover:underline"
              >
                {order.customerStats.ordersCount}{' '}
                {order.customerStats.ordersCount === 1 ? 'order' : 'orders'}
              </Link>
              <span>·</span>
              <span>
                {order.customerStats.ordersCount -
                  order.customerStats.failedDeliveryCount}
                /{order.customerStats.ordersCount} delivery rate
              </span>
            </div>

            <div className="mt-4 flex flex-col gap-2 text-sm text-neutral-700">
              <Row label={address.recipientName}>
                <CopyButton
                  value={address.recipientName}
                  label="Copy name"
                  iconOnly
                />
              </Row>
              <Row label={address.email}>
                <CopyButton value={address.email} label="Copy email" iconOnly />
              </Row>
              <Row label={address.phone}>
                <CopyButton value={address.phone} label="Copy phone" iconOnly />
              </Row>
              <p className="pt-1 text-neutral-500">{fullAddress}</p>
              {address.landmark && (
                <p className="text-neutral-400">Landmark: {address.landmark}</p>
              )}
              <div className="pt-1">
                <CopyButton value={fullAddress} label="Copy address" />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      {children}
    </div>
  )
}

function StatusForm({
  orderId,
  status,
  onSaved,
}: {
  orderId: string
  status: OrderStatus
  onSaved: () => void
}) {
  const nextOptions = NEXT_STATUSES[status]
  const [nextStatus, setNextStatus] = useState<OrderStatus | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!nextStatus) return
    setSubmitting(true)
    setError(null)
    try {
      await updateOrderStatus({ data: { orderId, status: nextStatus } })
      setNextStatus('')
      onSaved()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Status
      </h2>
      {nextOptions.length === 0 ? (
        <p className="text-sm text-neutral-500">
          This is a terminal status — no further transitions.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex items-end gap-3">
          <label className={labelClassName}>
            Move to
            <select
              value={nextStatus}
              onChange={(e) => setNextStatus(e.target.value as OrderStatus)}
              className={inputClassName}
            >
              <option value="">Select…</option>
              {nextOptions.map((option) => (
                <option key={option} value={option}>
                  {option.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={submitting || !nextStatus}
            className={buttonPrimaryClassName}
          >
            {submitting ? 'Updating…' : 'Update status'}
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Card>
  )
}

function CancelOrderPanel({
  orderId,
  status,
  onCancelled,
}: {
  orderId: string
  status: OrderStatus
  onCancelled: () => void
}) {
  const [open, setOpen] = useState(false)
  const [restock, setRestock] = useState(true)
  const [reason, setReason] = useState<CancellationReason | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!CANCELLABLE_STATUSES.has(status)) return null

  async function handleCancel() {
    if (!reason) {
      setError('Please select a reason for cancelling.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await cancelOrder({ data: { orderId, restock, reason } })
      onCancelled()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="border-red-100 p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Cancel order
      </h2>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={buttonSecondaryClassName}
        >
          Cancel order
        </button>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={restock}
              onChange={(e) => setRestock(e.target.checked)}
            />
            Restock these items back into inventory
          </label>
          <select
            value={reason}
            onChange={(e) =>
              setReason(e.target.value as CancellationReason | '')
            }
            className={inputClassName}
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
          <div className="flex gap-2">
            <button
              type="button"
              disabled={submitting || !reason}
              onClick={handleCancel}
              className="inline-flex w-fit items-center justify-center rounded-md bg-red-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Cancelling…' : 'Confirm cancellation'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={buttonSecondaryClassName}
            >
              Never mind
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </Card>
  )
}

function ShipmentForm({
  orderId,
  shipment,
  onSaved,
}: {
  orderId: string
  shipment: {
    carrier: string | null
    tracking_number: string | null
    tracking_url: string | null
    status: ShipmentStatus
  } | null
  onSaved: () => void
}) {
  const alreadyFulfilled = !!shipment?.tracking_number
  const [carrier, setCarrier] = useState(shipment?.carrier ?? '')
  const [trackingNumber, setTrackingNumber] = useState(
    shipment?.tracking_number ?? '',
  )
  const [trackingUrl, setTrackingUrl] = useState(shipment?.tracking_url ?? '')
  const [status, setStatus] = useState<ShipmentStatus>(
    shipment?.status && shipment.status !== 'pending'
      ? shipment.status
      : 'in_transit',
  )
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      // Pasting a tracking number is what marks the order fulfilled — the
      // status field only matters for advancing further after that.
      const nextStatus: ShipmentStatus =
        !alreadyFulfilled && trackingNumber.trim() ? 'in_transit' : status
      await upsertShipment({
        data: {
          orderId,
          carrier: carrier || undefined,
          trackingNumber: trackingNumber || undefined,
          trackingUrl: trackingUrl || undefined,
          status: nextStatus,
        },
      })
      onSaved()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Fulfillment
        </h2>
        <StatusBadge
          status={alreadyFulfilled ? shipment.status : 'unfulfilled'}
          kind="shipment"
        />
      </div>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <label className={labelClassName}>
          Courier
          <input
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            placeholder="J&T Express, LBC, Ninja Van…"
            className={inputClassName}
          />
        </label>
        <label className={labelClassName}>
          Tracking number
          <input
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
            className={inputClassName}
          />
        </label>
        <label className={labelClassName}>
          Courier tracking link
          <input
            value={trackingUrl}
            onChange={(e) => setTrackingUrl(e.target.value)}
            placeholder="https://…"
            className={inputClassName}
          />
        </label>
        {alreadyFulfilled && (
          <label className={labelClassName}>
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ShipmentStatus)}
              className={inputClassName}
            >
              {SHIPMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="submit"
          disabled={submitting}
          className={buttonPrimaryClassName}
        >
          {submitting
            ? 'Saving…'
            : alreadyFulfilled
              ? 'Update shipment'
              : 'Mark as fulfilled'}
        </button>
      </form>
      {shipment?.tracking_url && (
        <a
          href={shipment.tracking_url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs text-neutral-500 underline hover:text-neutral-900"
        >
          Track this shipment ↗
        </a>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Card>
  )
}

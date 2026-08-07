import { Fragment, useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { getLalamoveOrders } from '#/server/admin/orders'
import type { LalamoveOrderItemRow } from '#/server/admin/orders'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { PageHeader } from '#/components/admin/PageHeader'
import { StatusBadge } from '#/components/admin/Badge'
import {
  LalamoveBookingPanel,
  LalamoveRefreshButton,
} from '#/components/admin/LalamoveBookingPanel'
import {
  buttonSecondaryClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

const BOOKABLE_STATUSES = new Set(['paid', 'processing'])

export const Route = createFileRoute('/admin/orders/lalamove')({
  loader: () => getLalamoveOrders(),
  component: LalamoveOrdersPage,
})

/** Click-to-open list of what's in the order, with product images — same
 *  pattern as the main Orders table's Items column, so staff can see what
 *  to pack without leaving this page. */
function ItemsCell({ items }: { items: LalamoveOrderItemRow[] }) {
  const [open, setOpen] = useState(false)
  const count = items.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-neutral-700 underline decoration-dotted hover:text-neutral-950"
      >
        {count} item{count === 1 ? '' : 's'}
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute top-full left-0 z-20 mt-1 w-80 rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-lg">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Items to pack
            </p>
            <ul className="flex flex-col divide-y divide-neutral-100">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2.5 py-1.5 text-sm"
                >
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-md border border-neutral-200 object-cover"
                    />
                  ) : (
                    <div className="h-10 w-10 shrink-0 rounded-md border border-neutral-200 bg-neutral-50" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-neutral-900">
                      {item.productName}
                    </p>
                    <div className="flex items-center justify-between text-neutral-500">
                      <span>{item.variantLabel ?? '—'}</span>
                      <span>× {item.quantity}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

function LalamoveOrdersPage() {
  const orders = Route.useLoaderData()
  const router = useRouter()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const needsBooking = orders.filter((o) => !o.shipment)
  const booked = orders.filter((o) => o.shipment)

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Lalamove Orders"
        subtitle="Confirm and book same-day Lalamove deliveries, and track the ones already booked."
      />

      <h2 className="mb-2 text-sm font-semibold text-neutral-900">
        Needs Booking ({needsBooking.length})
      </h2>
      <div className={`${tableWrapperClassName} mb-8`}>
        {needsBooking.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">
            Nothing waiting to be booked.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClassName}>Order</th>
                  <th className={tableHeadClassName}>Customer</th>
                  <th className={tableHeadClassName}>Items</th>
                  <th className={tableHeadClassName}>Delivery address</th>
                  <th className={`${tableHeadClassName} text-right`}>
                    Est. fee
                  </th>
                  <th className={tableHeadClassName}>Status</th>
                  <th className={tableHeadClassName} />
                </tr>
              </thead>
              <tbody>
                {needsBooking.map((order) => {
                  const isExpanded = expandedId === order.id
                  const bookable =
                    BOOKABLE_STATUSES.has(order.status) && order.lalamoveInfo
                  return (
                    <Fragment key={order.id}>
                      <tr className={tableRowClassName}>
                        <td className={`${tableCellClassName} font-medium`}>
                          <Link
                            to="/admin/orders/$orderId"
                            params={{ orderId: order.id }}
                            className="hover:underline"
                          >
                            {order.orderNumber}
                          </Link>
                        </td>
                        <td className={tableCellClassName}>
                          <p>{order.recipientName}</p>
                          <p className="text-xs text-neutral-400">
                            {order.recipientEmail}
                          </p>
                        </td>
                        <td className={tableCellClassName}>
                          <ItemsCell items={order.items} />
                        </td>
                        <td
                          className={`${tableCellClassName} max-w-xs truncate text-neutral-500`}
                        >
                          {order.lalamoveInfo?.dropoffAddress ?? '—'}
                        </td>
                        <td className={`${tableCellClassName} text-right`}>
                          {order.lalamoveInfo
                            ? formatCentsAsPHP(
                                order.lalamoveInfo.estimatedFeeCents,
                              )
                            : '—'}
                        </td>
                        <td className={tableCellClassName}>
                          <StatusBadge status={order.status} kind="order" />
                        </td>
                        <td className={`${tableCellClassName} text-right`}>
                          {bookable ? (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedId(isExpanded ? null : order.id)
                              }
                              className={buttonSecondaryClassName}
                            >
                              {isExpanded ? 'Close' : 'Book'}
                            </button>
                          ) : (
                            <span className="text-xs text-neutral-400">
                              Not bookable
                            </span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && order.lalamoveInfo && (
                        <tr>
                          <td
                            colSpan={7}
                            className="border-t border-neutral-100 bg-neutral-50 p-4"
                          >
                            <LalamoveBookingPanel
                              orderId={order.id}
                              lalamoveInfo={order.lalamoveInfo}
                              onBooked={() => {
                                setExpandedId(null)
                                router.invalidate()
                              }}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <h2 className="mb-2 text-sm font-semibold text-neutral-900">
        Booked ({booked.length})
      </h2>
      <div className={tableWrapperClassName}>
        {booked.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">
            No booked Lalamove orders yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClassName}>Order</th>
                  <th className={tableHeadClassName}>Customer</th>
                  <th className={tableHeadClassName}>Items</th>
                  <th className={tableHeadClassName}>Tracking</th>
                  <th className={tableHeadClassName}>Status</th>
                  <th className={tableHeadClassName} />
                </tr>
              </thead>
              <tbody>
                {booked.map((order) => (
                  <tr key={order.id} className={tableRowClassName}>
                    <td className={`${tableCellClassName} font-medium`}>
                      <Link
                        to="/admin/orders/$orderId"
                        params={{ orderId: order.id }}
                        className="hover:underline"
                      >
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className={tableCellClassName}>
                      {order.recipientName}
                    </td>
                    <td className={tableCellClassName}>
                      <ItemsCell items={order.items} />
                    </td>
                    <td className={tableCellClassName}>
                      {order.shipment?.trackingUrl ? (
                        <a
                          href={order.shipment.trackingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          Track
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={tableCellClassName}>
                      {order.shipment && (
                        <StatusBadge
                          status={order.shipment.status}
                          kind="shipment"
                        />
                      )}
                    </td>
                    <td className={tableCellClassName}>
                      <LalamoveRefreshButton
                        orderId={order.id}
                        onRefreshed={() => router.invalidate()}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

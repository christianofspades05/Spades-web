import { useState } from 'react'
import { z } from 'zod'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  getOrdersForBulkFulfillment,
  upsertShipment,
} from '#/server/admin/orders'
import type { BulkFulfillmentOrder } from '#/server/admin/orders'
import { getErrorMessage } from '#/lib/utils/errors'
import { formatOrderItemsForCopy } from '#/lib/utils/order-items-text'
import { formatShippingAddress } from '#/lib/checkout/shipping-address'
import type { OrderShippingAddress } from '#/lib/checkout/shipping-address'
import { PageHeader } from '#/components/admin/PageHeader'
import { CopyButton } from '#/components/admin/CopyButton'
import { buttonPrimaryClassName } from '#/components/admin/ui'

const CELL = 'border border-neutral-200 px-2 py-1.5 align-top text-sm'
const CELL_INPUT =
  'w-full rounded border border-neutral-300 px-1.5 py-1 text-sm focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500'

export const Route = createFileRoute('/admin/orders/bulk-fulfill')({
  validateSearch: z.object({ ids: z.string() }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const orderIds = deps.ids.split(',').filter(Boolean)
    return getOrdersForBulkFulfillment({ data: { orderIds } })
  },
  component: BulkFulfillPage,
})

interface RowState {
  carrier: string
  trackingNumber: string
  trackingUrl: string
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  error: string | null
}

function initialRowState(order: BulkFulfillmentOrder): RowState {
  const shipment = order.shipments.at(0)
  return {
    carrier: shipment?.carrier ?? '',
    trackingNumber: shipment?.tracking_number ?? '',
    trackingUrl: shipment?.tracking_url ?? '',
    saveState: 'idle',
    error: null,
  }
}

function BulkFulfillPage() {
  const orders = Route.useLoaderData()
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(orders.map((o) => [o.id, initialRowState(o)])),
  )
  const [savingAll, setSavingAll] = useState(false)

  function updateRow(orderId: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [orderId]: { ...prev[orderId], ...patch } }))
  }

  async function saveRow(order: BulkFulfillmentOrder) {
    const row = rows[order.id]
    if (!row.trackingNumber.trim()) return
    updateRow(order.id, { saveState: 'saving', error: null })
    try {
      const existingShipment = order.shipments.at(0)
      const alreadyFulfilled = !!existingShipment?.tracking_number
      await upsertShipment({
        data: {
          orderId: order.id,
          carrier: row.carrier || undefined,
          trackingNumber: row.trackingNumber || undefined,
          trackingUrl: row.trackingUrl || undefined,
          status: alreadyFulfilled ? existingShipment.status : 'in_transit',
        },
      })
      updateRow(order.id, { saveState: 'saved' })
    } catch (err) {
      updateRow(order.id, { saveState: 'error', error: getErrorMessage(err) })
    }
  }

  async function handleSaveAll() {
    setSavingAll(true)
    for (const order of orders) {
      if (rows[order.id].trackingNumber.trim()) {
        await saveRow(order)
      }
    }
    setSavingAll(false)
  }

  const readyToSaveCount = orders.filter(
    (o) => rows[o.id].trackingNumber.trim() && rows[o.id].saveState !== 'saved',
  ).length

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Bulk fulfillment"
        subtitle={`${orders.length} ${orders.length === 1 ? 'order' : 'orders'} selected`}
        action={
          <button
            type="button"
            disabled={savingAll || readyToSaveCount === 0}
            onClick={handleSaveAll}
            className={buttonPrimaryClassName}
          >
            {savingAll
              ? 'Saving…'
              : `Save all${readyToSaveCount > 0 ? ` (${readyToSaveCount})` : ''}`}
          </button>
        }
      />

      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-neutral-50">
              <th className={`${CELL} font-semibold`}>Order</th>
              <th className={`${CELL} font-semibold`}>Name</th>
              <th className={`${CELL} font-semibold`}>Phone</th>
              <th className={`${CELL} font-semibold`}>Email</th>
              <th className={`${CELL} font-semibold`}>Address</th>
              <th className={`${CELL} font-semibold`}>Items</th>
              <th className={`${CELL} font-semibold`}>Courier</th>
              <th className={`${CELL} font-semibold`}>Tracking number</th>
              <th className={`${CELL} font-semibold`}>Tracking link</th>
              <th className={`${CELL} font-semibold`}>Save</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const address =
                order.shipping_address as unknown as OrderShippingAddress
              const fullAddress = formatShippingAddress(address)
              const itemsText = formatOrderItemsForCopy(order.order_items)
              const row = rows[order.id]

              return (
                <tr key={order.id}>
                  <td className={CELL}>
                    <Link
                      to="/admin/orders/$orderId"
                      params={{ orderId: order.id }}
                      className="font-medium text-neutral-900 hover:underline"
                    >
                      {order.order_number}
                    </Link>
                  </td>
                  <td className={CELL}>
                    <div className="flex items-center justify-between gap-2">
                      <span>{order.customer.full_name ?? '—'}</span>
                      {order.customer.full_name && (
                        <CopyButton
                          value={order.customer.full_name}
                          label="Copy name"
                          iconOnly
                        />
                      )}
                    </div>
                  </td>
                  <td className={CELL}>
                    <div className="flex items-center justify-between gap-2">
                      <span>{order.customer.phone ?? '—'}</span>
                      {order.customer.phone && (
                        <CopyButton
                          value={order.customer.phone}
                          label="Copy phone"
                          iconOnly
                        />
                      )}
                    </div>
                  </td>
                  <td className={CELL}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{order.customer.email}</span>
                      <CopyButton
                        value={order.customer.email}
                        label="Copy email"
                        iconOnly
                      />
                    </div>
                  </td>
                  <td className={`${CELL} max-w-[16rem]`}>
                    <div className="flex items-start justify-between gap-2">
                      <span>{fullAddress}</span>
                      <CopyButton
                        value={fullAddress}
                        label="Copy address"
                        iconOnly
                      />
                    </div>
                  </td>
                  <td className={`${CELL} max-w-[12rem]`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="whitespace-pre-line">{itemsText}</span>
                      <CopyButton
                        value={itemsText}
                        label="Copy items"
                        iconOnly
                      />
                    </div>
                  </td>
                  <td className={CELL}>
                    <input
                      value={row.carrier}
                      onChange={(e) =>
                        updateRow(order.id, {
                          carrier: e.target.value,
                          saveState: 'idle',
                        })
                      }
                      placeholder="J&T, LBC…"
                      className={CELL_INPUT}
                    />
                  </td>
                  <td className={CELL}>
                    <input
                      value={row.trackingNumber}
                      onChange={(e) =>
                        updateRow(order.id, {
                          trackingNumber: e.target.value,
                          saveState: 'idle',
                        })
                      }
                      className={CELL_INPUT}
                    />
                  </td>
                  <td className={CELL}>
                    <input
                      value={row.trackingUrl}
                      onChange={(e) =>
                        updateRow(order.id, {
                          trackingUrl: e.target.value,
                          saveState: 'idle',
                        })
                      }
                      placeholder="https://…"
                      className={CELL_INPUT}
                    />
                  </td>
                  <td className={CELL}>
                    <button
                      type="button"
                      disabled={
                        row.saveState === 'saving' || !row.trackingNumber.trim()
                      }
                      onClick={() => saveRow(order)}
                      className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {row.saveState === 'saving'
                        ? 'Saving…'
                        : row.saveState === 'saved'
                          ? 'Saved ✓'
                          : 'Save'}
                    </button>
                    {row.error && (
                      <p className="mt-1 text-xs text-red-600">{row.error}</p>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

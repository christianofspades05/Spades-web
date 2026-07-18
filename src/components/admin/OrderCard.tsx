import { useRef, useState } from 'react'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { Badge, StatusBadge } from '#/components/admin/Badge'
import { Card } from '#/components/admin/Card'
import type { OrderSource } from '#/types/entities'

const SOURCE_LABELS: Record<OrderSource, string> = {
  storefront: 'Online Store',
  admin: 'Admin (manual)',
  tiktok_shop: 'TikTok Shop',
  shopee: 'Shopee',
  lazada: 'Lazada',
}

const LONG_PRESS_MS = 500

export interface OrderCardItem {
  id: string
  image_url: string | null
  product_name_snapshot: string
  variant_id: string | null
  variant_label_snapshot: string | null
  quantity: number
}

export interface OrderCardData {
  id: string
  order_number: string
  placed_at: string
  status: string
  total_cents: number
  is_cod: boolean
  source: OrderSource
  customer: { full_name: string | null; email: string }
  payments: { status: string; created_at: string }[]
  shipments: { status: string }[]
  order_items: OrderCardItem[]
}

/** Mobile card rendering of an order-list row — the same data as the desktop table row (kept out of orders/index.tsx to avoid adding to that file's already-heavy route-type-checking surface). Long-pressing the card shows the item list in a popup instead of navigating away, the same shortcut the desktop table's item-count button already gives — a plain tap still opens the full order. */
export function OrderCard({
  order,
  checked,
  onToggle,
  onOpen,
}: {
  order: OrderCardData
  checked: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const [showItems, setShowItems] = useState(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)

  const latestPayment = [...order.payments]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .at(0)
  const shipment = order.shipments.at(0)
  const itemCount = order.order_items.reduce((sum, i) => sum + i.quantity, 0)

  function clearLongPressTimer() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  function handleTouchStart() {
    longPressFired.current = false
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      setShowItems(true)
    }, LONG_PRESS_MS)
  }

  function handleClick() {
    // A long-press already opened the item popup — the click that follows
    // the touch shouldn't also navigate to the full order.
    if (longPressFired.current) {
      longPressFired.current = false
      return
    }
    onOpen()
  }

  return (
    <>
      <Card
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={clearLongPressTimer}
        onTouchMove={clearLongPressTimer}
        className={`cursor-pointer p-4 ${
          order.status === 'cancelled' ? 'opacity-60' : ''
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div
            className="flex items-center gap-2.5"
            onClick={(e) => e.stopPropagation()}
          >
            <input type="checkbox" checked={checked} onChange={onToggle} />
            <div>
              <p className="font-medium text-neutral-900">
                {order.order_number}
              </p>
              <p className="text-xs text-neutral-500">
                {new Date(order.placed_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
                {' · '}
                {new Date(order.placed_at).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </p>
            </div>
          </div>
          <p className="font-medium text-neutral-900">
            {formatCentsAsPHP(order.total_cents)}
          </p>
        </div>

        <p className="mt-2.5 text-sm text-neutral-600">
          {order.customer.full_name ?? order.customer.email}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {order.is_cod ? (
            <Badge tone="neutral">Cash on Delivery</Badge>
          ) : latestPayment ? (
            <StatusBadge status={latestPayment.status} kind="payment" />
          ) : null}
          <StatusBadge
            status={shipment?.status ?? 'unfulfilled'}
            kind="shipment"
          />
        </div>

        <div className="mt-2.5 flex items-center justify-between text-xs text-neutral-500">
          <span>{SOURCE_LABELS[order.source]}</span>
          <span>
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </span>
        </div>
      </Card>

      {showItems && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          onClick={() => setShowItems(false)}
        >
          <div
            className="w-full max-w-sm rounded-t-xl bg-white p-4 shadow-lg sm:rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                Items in {order.order_number}
              </p>
              <button
                type="button"
                onClick={() => setShowItems(false)}
                className="text-xs font-medium text-neutral-500 underline"
              >
                Close
              </button>
            </div>
            <ul className="flex max-h-80 flex-col divide-y divide-neutral-100 overflow-y-auto">
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
                      <span>{item.variant_label_snapshot ?? '—'}</span>
                      <span>× {item.quantity}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}

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
  order_items: { quantity: number }[]
}

/** Mobile card rendering of an order-list row — the same data as the desktop table row (kept out of orders/index.tsx to avoid adding to that file's already-heavy route-type-checking surface). */
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
  const latestPayment = [...order.payments]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .at(0)
  const shipment = order.shipments.at(0)
  const itemCount = order.order_items.reduce((sum, i) => sum + i.quantity, 0)

  return (
    <Card
      onClick={onOpen}
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
            <p className="font-medium text-neutral-900">{order.order_number}</p>
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
  )
}

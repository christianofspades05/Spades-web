import { Card } from '#/components/admin/Card'
import { Badge } from '#/components/admin/Badge'
import { formatCentsAsPHP } from '#/lib/utils/money'

export interface CustomerCardData {
  id: string
  full_name: string | null
  email: string
  phone: string | null
  is_guest: boolean
  is_high_risk: boolean
  cod_blocked: boolean
  orders_count: number
  cancelled_orders_count: number
  return_count: number
  amount_spent_cents: number
}

/** Mobile card rendering of a customer-list row — kept out of customers/index.tsx to avoid adding to that file's route-type-checking surface (see OrderCard.tsx for the same reasoning). */
export function CustomerCard({
  customer,
  onOpen,
}: {
  customer: CustomerCardData
  onOpen: () => void
}) {
  return (
    <Card onClick={onOpen} className="cursor-pointer p-4">
      <div className="flex items-center gap-2">
        <p className="font-medium text-neutral-900">
          {customer.full_name ?? customer.email}
        </p>
        {customer.is_guest && <Badge tone="neutral">Guest</Badge>}
      </div>

      <p className="mt-1 text-sm text-neutral-500">{customer.email}</p>
      {customer.phone && (
        <p className="text-sm text-neutral-500">{customer.phone}</p>
      )}

      <div className="mt-2.5 flex items-center justify-between">
        <div className="flex gap-4 text-sm text-neutral-600">
          <span>{customer.orders_count} orders</span>
          {customer.cancelled_orders_count > 0 && (
            <span>{customer.cancelled_orders_count} cancelled</span>
          )}
          {customer.return_count > 0 && (
            <span>{customer.return_count} returns</span>
          )}
        </div>
        <div className="flex gap-1.5">
          {customer.is_high_risk && <Badge tone="warning">High risk</Badge>}
          {customer.cod_blocked && <Badge tone="critical">COD blocked</Badge>}
        </div>
      </div>
      <p className="mt-1.5 text-sm font-medium text-neutral-900">
        {formatCentsAsPHP(customer.amount_spent_cents)} spent
      </p>
    </Card>
  )
}

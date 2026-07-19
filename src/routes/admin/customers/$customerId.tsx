import { useState } from 'react'
import {
  createFileRoute,
  Link,
  notFound,
  useRouter,
} from '@tanstack/react-router'
import { getCustomerById, updateCustomerRisk } from '#/server/admin/customers'
import type { CustomerWithDetails } from '#/server/admin/customers'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import { formatRegionLabel } from '#/lib/utils/ph-region'
import { PageHeader } from '#/components/admin/PageHeader'
import { Card } from '#/components/admin/Card'
import { Badge, StatusBadge } from '#/components/admin/Badge'
import {
  buttonPrimaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/admin/ui'

export const Route = createFileRoute('/admin/customers/$customerId')({
  loader: async ({ params }) => {
    const customer = await getCustomerById({ data: { id: params.customerId } })
    if (!customer) throw notFound()
    return customer
  },
  component: CustomerDetailPage,
})

function CustomerDetailPage() {
  const customer: CustomerWithDetails = Route.useLoaderData()
  const router = useRouter()

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title={customer.full_name ?? customer.email}
        subtitle={customer.email}
        action={
          <div className="flex gap-1.5">
            {customer.is_guest && <Badge tone="neutral">Guest</Badge>}
            {customer.is_high_risk && <Badge tone="warning">High risk</Badge>}
            {customer.cod_blocked && <Badge tone="critical">COD blocked</Badge>}
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Card className="p-3.5">
          <p className="text-xs font-medium text-neutral-500">Orders</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {customer.orders.length}
          </p>
        </Card>
        <Card className="p-3.5">
          <p className="text-xs font-medium text-neutral-500">Amount Spent</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {formatCentsAsPHP(customer.amount_spent_cents)}
          </p>
        </Card>
        <Card className="p-3.5">
          <p className="text-xs font-medium text-neutral-500">Cancelled</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {customer.cancelled_orders_count}
          </p>
        </Card>
        <Card className="p-3.5">
          <p className="text-xs font-medium text-neutral-500">
            Failed deliveries
          </p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {customer.failed_delivery_count}
          </p>
        </Card>
        <Card className="p-3.5">
          <p className="text-xs font-medium text-neutral-500">
            Returns (incl. failed delivery)
          </p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {customer.return_count}
          </p>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Orders
        </h2>
        {customer.orders.length === 0 ? (
          <p className="text-sm text-neutral-500">No orders yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-neutral-100">
            {customer.orders.map((order) => (
              <li
                key={order.id}
                className="flex items-center justify-between py-3 text-sm"
              >
                <div>
                  <Link
                    to="/admin/orders/$orderId"
                    params={{ orderId: order.id }}
                    className="font-medium text-neutral-900 hover:underline"
                  >
                    {order.order_number}
                  </Link>
                  <p className="text-neutral-500">
                    {new Date(order.placed_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={order.status} kind="order" />
                  <p className="font-medium text-neutral-900">
                    {formatCentsAsPHP(order.total_cents)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-6 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Addresses
        </h2>
        {customer.addresses.length === 0 ? (
          <p className="text-sm text-neutral-500">No saved addresses.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-neutral-100">
            {customer.addresses.map((address) => (
              <li key={address.id} className="py-3 text-sm">
                <p className="font-medium text-neutral-900">
                  {address.recipient_name}
                  {address.label && (
                    <span className="ml-2 font-normal text-neutral-500">
                      {address.label}
                    </span>
                  )}
                </p>
                <p className="text-neutral-500">{address.phone}</p>
                <p className="text-neutral-500">
                  {[
                    address.address_line1,
                    address.address_line2,
                    address.barangay,
                    address.city,
                    address.province,
                    formatRegionLabel(address.region),
                    address.postal_code,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="mt-6">
        <RiskForm customer={customer} onSaved={() => router.invalidate()} />
      </div>
    </div>
  )
}

function RiskForm({
  customer,
  onSaved,
}: {
  customer: {
    id: string
    is_high_risk: boolean
    cod_blocked: boolean
    risk_notes: string | null
  }
  onSaved: () => void
}) {
  const [isHighRisk, setIsHighRisk] = useState(customer.is_high_risk)
  const [codBlocked, setCodBlocked] = useState(customer.cod_blocked)
  const [riskNotes, setRiskNotes] = useState(customer.risk_notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await updateCustomerRisk({
        data: {
          id: customer.id,
          isHighRisk,
          codBlocked,
          riskNotes: riskNotes || undefined,
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
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Risk & trust
      </h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-5">
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
            <input
              type="checkbox"
              checked={isHighRisk}
              onChange={(e) => setIsHighRisk(e.target.checked)}
            />
            High risk
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
            <input
              type="checkbox"
              checked={codBlocked}
              onChange={(e) => setCodBlocked(e.target.checked)}
            />
            Block cash-on-delivery
          </label>
        </div>
        <label className={labelClassName}>
          Notes
          <textarea
            value={riskNotes}
            onChange={(e) => setRiskNotes(e.target.value)}
            rows={3}
            className={inputClassName}
          />
        </label>
        <button
          type="submit"
          disabled={submitting}
          className={buttonPrimaryClassName}
        >
          {submitting ? 'Saving…' : 'Save changes'}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Card>
  )
}

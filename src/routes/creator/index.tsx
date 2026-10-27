import { createFileRoute } from '@tanstack/react-router'
import { getCreatorDashboard } from '#/server/creator/dashboard'
import { formatCentsAsPHP as money } from '#/lib/utils/money'
import {
  tableWrapperClassName,
  tableCellClassName as cell,
  tableHeadClassName as head,
} from '#/components/admin/ui'

export const Route = createFileRoute('/creator/')({
  loader: () => getCreatorDashboard(),
  component: CreatorDashboardPage,
})

function CreatorDashboardPage() {
  const data = Route.useLoaderData()

  return (
    <div>
      <h1 className="text-lg font-semibold text-neutral-900">
        Your code performance
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        Every order that used one of your codes, and what you've earned.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        {data.codes.map((c) => (
          <span
            key={c.code}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              c.isActive
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-neutral-200 bg-neutral-100 text-neutral-500'
            }`}
          >
            {c.code} · {c.commissionBps / 100}% commission
            {!c.isActive && ' · inactive'}
          </span>
        ))}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Orders using your code', data.totals.orders],
          ['Pending commission', money(data.totals.pending)],
          ['Approved, awaiting payout', money(data.totals.approved)],
          ['Paid out so far', money(data.totals.paid)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-white p-4">
            <p className="text-xs text-neutral-500">{label}</p>
            <p className="mt-2 text-xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold text-neutral-900">
        Orders
      </h2>
      {data.orders.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No orders have used your code yet.
        </p>
      ) : (
        <div className={tableWrapperClassName}>
          <table className="w-full">
            <thead>
              <tr>
                {['Order', 'Date', 'Status', 'You earned', ''].map((h) => (
                  <th key={h} className={head}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.orders.map((o, i) => (
                <tr key={i}>
                  <td className={cell}>{o.orderNumber}</td>
                  <td className={cell}>
                    {new Date(o.createdAt).toLocaleDateString()}
                  </td>
                  <td className={cell}>
                    <span className="text-xs font-semibold">{o.status}</span>
                  </td>
                  <td className={cell}>{money(o.earnedCents)}</td>
                  <td className={cell}>
                    {o.holdReasons.map((reason) => (
                      <p key={reason} className="text-xs text-amber-700">
                        {reason}
                      </p>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-8 mb-3 text-sm font-semibold text-neutral-900">
        Payouts
      </h2>
      {data.payouts.length === 0 ? (
        <p className="text-sm text-neutral-500">No payouts yet.</p>
      ) : (
        <div className={tableWrapperClassName}>
          <table className="w-full">
            <thead>
              <tr>
                {['Reference', 'Date', 'Amount'].map((h) => (
                  <th key={h} className={head}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.payouts.map((p) => (
                <tr key={p.id}>
                  <td className={cell}>{p.reference}</td>
                  <td className={cell}>
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                  <td className={cell}>{money(p.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

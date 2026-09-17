import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { listCreators } from '#/server/admin/creators'
import { CreatorProfileForm } from '#/components/admin/CreatorProfileForm'
import { PageHeader } from '#/components/admin/PageHeader'
import { formatCentsAsPHP as money } from '#/lib/utils/money'
import {
  buttonPrimaryClassName,
  inputClassName,
  tableWrapperClassName,
  tableHeadClassName,
  tableCellClassName,
  tableRowClassName,
} from '#/components/admin/ui'

export const Route = createFileRoute('/admin/creators/')({
  loader: () => listCreators(),
  component: CreatorsPage,
})
function CreatorsPage() {
  const { creators } = Route.useLoaderData()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const filtered = creators.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase()),
  )
  return (
    <div className="px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Creators & Affiliates"
        subtitle="Code attribution, commissions and creator costs"
        action={
          <button
            className={buttonPrimaryClassName}
            onClick={() => setAdding(!adding)}
          >
            {adding ? 'Close' : 'Add creator'}
          </button>
        }
      />
      {adding && (
        <div className="mb-6">
          <CreatorProfileForm
            onSaved={async (creatorId) => {
              await navigate({
                to: '/admin/creators/$creatorId',
                params: { creatorId },
              })
            }}
          />
        </div>
      )}
      <input
        aria-label="Search creators"
        placeholder="Search creators"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setPage(0)
        }}
        className={`${inputClassName} mb-4 max-w-sm`}
      />
      <div className={tableWrapperClassName}>
        <table className="w-full">
          <thead>
            <tr>
              {[
                'Creator',
                'Orders',
                'Retained product sales',
                'Pending commission',
                'Payable',
                'Contribution*',
              ].map((h) => (
                <th key={h} className={tableHeadClassName}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(page * 25, (page + 1) * 25).map((c) => (
              <tr key={c.id} className={tableRowClassName}>
                <td className={tableCellClassName}>
                  <Link
                    className="font-medium underline"
                    to="/admin/creators/$creatorId"
                    params={{ creatorId: c.id }}
                  >
                    {c.name}
                  </Link>
                  {!c.is_active && (
                    <span className="ml-2 text-neutral-400">Archived</span>
                  )}
                </td>
                <td className={tableCellClassName}>{c.totals.orders}</td>
                <td className={tableCellClassName}>{money(c.totals.sales)}</td>
                <td className={tableCellClassName}>
                  {money(c.totals.pending)}
                </td>
                <td className={tableCellClassName}>
                  {money(c.totals.payable)}
                </td>
                <td className={tableCellClassName}>
                  {c.totals.missingCosts
                    ? 'Cost incomplete'
                    : money(c.totals.contribution)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <p className="p-8 text-center text-neutral-500">
            No creators yet. Add a creator, then assign an existing discount
            code.
          </p>
        )}
      </div>
      <div className="my-4 flex gap-4 text-sm">
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>
          {page + 1} / {Math.max(1, Math.ceil(filtered.length / 25))}
        </span>
        <button
          disabled={(page + 1) * 25 >= filtered.length}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        *Contribution includes product costs, creator commissions and recorded
        expenses. Shipping, gateway fees and unrecorded expenses are excluded.
        Pending sales remain provisional.
      </p>
    </div>
  )
}

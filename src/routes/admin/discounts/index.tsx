import { useState } from 'react'
import { z } from 'zod'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { getDiscountsCount, listDiscounts } from '#/server/admin/discounts'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { PageHeader } from '#/components/admin/PageHeader'
import { Badge } from '#/components/admin/Badge'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'
import type { Discount } from '#/types/entities'

const PAGE_SIZE = 50

export const Route = createFileRoute('/admin/discounts/')({
  validateSearch: z.object({
    q: z.string().optional(),
    page: z.number().int().min(1).catch(1),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const filters = { q: deps.q }
    const [discounts, { total }] = await Promise.all([
      listDiscounts({ data: { ...filters, page: deps.page } }),
      getDiscountsCount({ data: filters }),
    ])
    return { discounts, total }
  },
  component: DiscountsPage,
})

type DiscountStatus = 'active' | 'scheduled' | 'expired' | 'inactive'

function computeStatus(d: Discount): DiscountStatus {
  if (!d.is_active) return 'inactive'
  const now = new Date()
  if (d.starts_at && new Date(d.starts_at) > now) return 'scheduled'
  if (d.ends_at && new Date(d.ends_at) < now) return 'expired'
  if (d.max_uses !== null && d.times_used >= d.max_uses) return 'expired'
  return 'active'
}

const STATUS_TONE: Record<
  DiscountStatus,
  'success' | 'info' | 'critical' | 'neutral'
> = {
  active: 'success',
  scheduled: 'info',
  expired: 'critical',
  inactive: 'neutral',
}

function valueLabel(d: Discount): string {
  return d.type === 'percentage'
    ? `${d.value}% off`
    : `${formatCentsAsPHP(d.value)} off`
}

function DiscountsPage() {
  const { discounts, total } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [searchInput, setSearchInput] = useState(search.q ?? '')

  const page = search.page
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rangeStartIndex = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEndIndex = Math.min(page * PAGE_SIZE, total)

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault()
    navigate({
      search: (prev) => ({ ...prev, q: searchInput || undefined, page: 1 }),
    })
  }

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Discounts"
        subtitle={`${total} ${total === 1 ? 'discount' : 'discounts'}`}
        action={
          <Link to="/admin/discounts/new" className={buttonPrimaryClassName}>
            Create discount
          </Link>
        }
      />

      <form onSubmit={handleSearchSubmit} className="mb-4 w-full max-w-sm">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by title or code"
          className={`${inputClassName} w-full`}
        />
      </form>

      <div className={tableWrapperClassName}>
        {discounts.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">
            {total === 0 && !search.q
              ? 'No discounts yet. Create a discount code customers can enter at checkout, or a store sale that applies automatically.'
              : 'No discounts match your search.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClassName}>Title</th>
                  <th className={tableHeadClassName}>Status</th>
                  <th className={tableHeadClassName}>Method</th>
                  <th className={tableHeadClassName}>Value</th>
                  <th className={tableHeadClassName}>Collections</th>
                  <th className={`${tableHeadClassName} text-right`}>Used</th>
                </tr>
              </thead>
              <tbody>
                {discounts.map((discount) => {
                  const status = computeStatus(discount)
                  return (
                    <tr key={discount.id} className={tableRowClassName}>
                      <td className={tableCellClassName}>
                        <Link
                          to="/admin/discounts/$discountId"
                          params={{ discountId: discount.id }}
                          className="font-medium text-neutral-900 hover:underline"
                        >
                          {discount.title}
                        </Link>
                        {discount.code && (
                          <p className="text-xs text-neutral-500">
                            {discount.code}
                          </p>
                        )}
                      </td>
                      <td className={tableCellClassName}>
                        <Badge tone={STATUS_TONE[status]}>{status}</Badge>
                      </td>
                      <td className={`${tableCellClassName} text-neutral-500`}>
                        {discount.kind === 'code'
                          ? 'Discount code'
                          : discount.scope === 'collection'
                            ? 'Collection sale'
                            : 'Store sale'}
                      </td>
                      <td className={`${tableCellClassName} text-neutral-500`}>
                        {valueLabel(discount)}
                      </td>
                      <td className={`${tableCellClassName} text-neutral-500`}>
                        {discount.scope === 'collection'
                          ? `${discount.scope_ids.length} included`
                          : discount.excluded_collection_ids.length > 0
                            ? `${discount.excluded_collection_ids.length} excluded`
                            : '—'}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {discount.times_used}
                        {discount.max_uses !== null &&
                          ` / ${discount.max_uses}`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-500">
          <p>
            Showing {rangeStartIndex}–{rangeEndIndex} of {total}
          </p>
          <div className="flex items-center gap-3">
            <Link
              to="/admin/discounts"
              from={Route.fullPath}
              search={(prev) => ({ ...prev, page: page - 1 })}
              aria-disabled={page <= 1}
              className={`${buttonSecondaryClassName} ${page <= 1 ? 'pointer-events-none opacity-40' : ''}`}
            >
              Previous
            </Link>
            <span className="text-xs text-neutral-400">
              Page {page} of {totalPages}
            </span>
            <Link
              to="/admin/discounts"
              from={Route.fullPath}
              search={(prev) => ({ ...prev, page: page + 1 })}
              aria-disabled={page >= totalPages}
              className={`${buttonSecondaryClassName} ${page >= totalPages ? 'pointer-events-none opacity-40' : ''}`}
            >
              Next
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

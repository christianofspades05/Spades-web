import { z } from 'zod'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Package } from 'lucide-react'
import { getRestocksCount, listRestocks } from '#/server/admin/products'
import { PageHeader } from '#/components/admin/PageHeader'
import {
  buttonSecondaryClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

const PAGE_SIZE = 50

export const Route = createFileRoute('/admin/restock/')({
  // `page` stays genuinely optional (never `.catch()`) — a route whose
  // every search field uses `.catch()` with none truly optional has been
  // confirmed (live, more than once elsewhere in this admin) to poison
  // <Link> type inference for unrelated routes throughout AdminNav. The
  // actual default is resolved in the loader below instead.
  validateSearch: z.object({
    page: z.number().int().min(1).optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const page = deps.page ?? 1
    const [restocks, { total }] = await Promise.all([
      listRestocks({ data: { page, pageSize: PAGE_SIZE } }),
      getRestocksCount(),
    ])
    return { restocks, total, page }
  },
  component: RestockPage,
})

/** restockedAt is a bare YYYY-MM-DD — parsed as local midnight (not UTC),
 *  so it always displays as the same calendar day staff picked/logged,
 *  regardless of the viewer's timezone offset. */
function formatRestockDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Whole calendar days between the restock date and today, both taken at
 *  local midnight — the window staff reason about sell-through over ("123
 *  added, 40 days ago, 10 left now" lets them eyeball units moved per day
 *  themselves from the columns already on this page). */
function daysSinceRestock(dateStr: string): number {
  const restockDate = new Date(`${dateStr}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffMs = today.getTime() - restockDate.getTime()
  return Math.max(0, Math.round(diffMs / (24 * 60 * 60 * 1000)))
}

function RestockPage() {
  const { restocks, total, page } = Route.useLoaderData()
  const navigate = Route.useNavigate()
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rangeStartIndex = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEndIndex = Math.min(page * PAGE_SIZE, total)

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Restock"
        subtitle={`${total} ${total === 1 ? 'restock' : 'restocks'} logged`}
      />

      {restocks.length === 0 ? (
        <p className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
          No restocks logged yet — use the Restock button on a product's page to
          log one.
        </p>
      ) : (
        <>
          <div className={`${tableWrapperClassName} overflow-x-auto`}>
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClassName}>Product</th>
                  <th className={tableHeadClassName}>Restocked</th>
                  <th className={`${tableHeadClassName} text-right`}>
                    Days since
                  </th>
                  <th className={`${tableHeadClassName} text-right`}>
                    Qty added
                  </th>
                  <th className={`${tableHeadClassName} text-right`}>
                    Current quantity
                  </th>
                </tr>
              </thead>
              <tbody>
                {restocks.map((row) => {
                  const daysSince = daysSinceRestock(row.restockedAt)
                  return (
                    <tr
                      key={`${row.productId}:${row.restockedAt}`}
                      className={tableRowClassName}
                    >
                      <td className={tableCellClassName}>
                        <div className="flex items-center gap-3">
                          {row.productImage ? (
                            <img
                              src={row.productImage}
                              alt=""
                              className="size-10 rounded-md border border-neutral-200 object-cover"
                            />
                          ) : (
                            <div className="flex size-10 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50">
                              <Package size={16} className="text-neutral-300" />
                            </div>
                          )}
                          <div>
                            <Link
                              to="/admin/products/$productId"
                              params={{ productId: row.productId }}
                              className="font-medium text-neutral-900 hover:underline"
                            >
                              {row.productName}
                            </Link>
                            <p className="text-xs text-neutral-500">
                              {row.variantCount}{' '}
                              {row.variantCount === 1 ? 'variant' : 'variants'}{' '}
                              restocked
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className={tableCellClassName}>
                        {formatRestockDate(row.restockedAt)}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {daysSince === 0
                          ? 'Today'
                          : `${daysSince} ${daysSince === 1 ? 'day' : 'days'}`}
                      </td>
                      <td
                        className={`${tableCellClassName} text-right font-medium text-emerald-600`}
                      >
                        +{row.quantityAdded}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {row.currentQuantityAvailable}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-neutral-500">
              <p>
                Showing {rangeStartIndex}–{rangeEndIndex} of {total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() =>
                    navigate({
                      search: (prev) => ({ ...prev, page: page - 1 }),
                    })
                  }
                  className={`${buttonSecondaryClassName} inline-flex items-center gap-1 ${page <= 1 ? 'pointer-events-none opacity-40' : ''}`}
                >
                  <ChevronLeft size={14} />
                  Previous
                </button>
                <span className="text-xs text-neutral-400">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() =>
                    navigate({
                      search: (prev) => ({ ...prev, page: page + 1 }),
                    })
                  }
                  className={`${buttonSecondaryClassName} inline-flex items-center gap-1 ${page >= totalPages ? 'pointer-events-none opacity-40' : ''}`}
                >
                  Next
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

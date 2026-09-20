import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  CUSTOMER_REPLIES_PAGE_SIZE,
  listFailedDeliveryReplies,
} from '#/server/admin/order-emails'
import { PageHeader } from '#/components/admin/PageHeader'
import {
  buttonSecondaryClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

export const Route = createFileRoute('/admin/customer-replies/')({
  loader: () => listFailedDeliveryReplies({ data: { page: 1 } }),
  component: CustomerRepliesPage,
})

/**
 * Replies to the automatic failed-delivery email specifically (orders
 * cancelled with reason 'failed_delivery') — not the general order-email
 * inbox the nav bell's dropdown covers, which includes replies to shipment
 * tracking emails, ad-hoc staff messages, etc. Paginated with local state
 * rather than a URL search param (unlike most other admin list pages)
 * since a single-field, all-defaulted validateSearch schema here confused
 * TanStack Router's search-param inference for unrelated Links elsewhere
 * in the admin nav — not worth chasing for a page nobody needs to bookmark
 * mid-page anyway.
 *
 * Viewing a reply here does NOT mark it read (matches the dropdown's own
 * behavior) — only opening the order's own thread does that (see
 * listOrderEmailMessages), since that's where a reply actually gets acted
 * on.
 */
function CustomerRepliesPage() {
  const initial = Route.useLoaderData()
  const [page, setPage] = useState(1)
  const [result, setResult] = useState(initial)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (page === 1) {
      setResult(initial)
      return
    }
    let cancelled = false
    setLoading(true)
    listFailedDeliveryReplies({ data: { page } })
      .then((data) => {
        if (!cancelled) setResult(data)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, initial])

  const { items, total } = result
  const totalPages = Math.max(1, Math.ceil(total / CUSTOMER_REPLIES_PAGE_SIZE))
  const rangeStartIndex =
    total === 0 ? 0 : (page - 1) * CUSTOMER_REPLIES_PAGE_SIZE + 1
  const rangeEndIndex = Math.min(page * CUSTOMER_REPLIES_PAGE_SIZE, total)

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Customer Replies"
        subtitle={`${total} ${total === 1 ? 'reply' : 'replies'}`}
      />

      <div className={`${tableWrapperClassName} ${loading ? 'opacity-60' : ''}`}>
        {items.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">No replies yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClassName}>Order</th>
                  <th className={tableHeadClassName}>Message</th>
                  <th className={tableHeadClassName}>Received</th>
                  <th className={tableHeadClassName}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((reply) => (
                  <tr key={reply.id} className={tableRowClassName}>
                    <td className={tableCellClassName}>
                      <div className="flex items-center gap-2">
                        {!reply.read && (
                          <span
                            className="size-1.5 shrink-0 rounded-full bg-red-500"
                            aria-label="Unread"
                          />
                        )}
                        <span
                          className={
                            reply.read
                              ? 'font-normal text-neutral-600'
                              : 'font-medium text-neutral-900'
                          }
                        >
                          {reply.orderNumber}
                        </span>
                      </div>
                    </td>
                    <td className={`${tableCellClassName} max-w-md`}>
                      <p className="line-clamp-2 text-neutral-700">
                        {reply.bodyText ?? '(no message)'}
                      </p>
                    </td>
                    <td className={`${tableCellClassName} text-neutral-500`}>
                      {new Date(reply.createdAt).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className={tableCellClassName}>
                      <Link
                        to="/admin/orders/$orderId"
                        params={{ orderId: reply.orderId }}
                        className={`${buttonSecondaryClassName} px-2 py-1 text-xs`}
                      >
                        View order
                      </Link>
                    </td>
                  </tr>
                ))}
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
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={`${buttonSecondaryClassName} ${page <= 1 ? 'pointer-events-none opacity-40' : ''}`}
            >
              Previous
            </button>
            <span className="text-xs text-neutral-400">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className={`${buttonSecondaryClassName} ${page >= totalPages ? 'pointer-events-none opacity-40' : ''}`}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

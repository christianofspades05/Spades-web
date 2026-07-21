import { useState } from 'react'
import { z } from 'zod'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { listReviews, setReviewStatus } from '#/server/admin/reviews'
import { getErrorMessage } from '#/lib/utils/errors'
import { REVIEW_STATUSES } from '#/lib/validation/admin/reviews'
import { PageHeader } from '#/components/admin/PageHeader'
import { StatusBadge } from '#/components/admin/Badge'
import { Stars } from '#/components/storefront/Stars'
import {
  buttonSecondaryClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'
import type { ReviewStatus } from '#/types/entities'

const REVIEW_RATINGS = [1, 2, 3, 4, 5] as const

export const Route = createFileRoute('/admin/reviews/')({
  validateSearch: z.object({
    status: z.enum(REVIEW_STATUSES).optional(),
    rating: z.coerce.number().int().min(1).max(5).optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    listReviews({ data: { status: deps.status, rating: deps.rating } }),
  component: ReviewsPage,
})

function ReviewsPage() {
  const reviews = Route.useLoaderData()
  const search = Route.useSearch()
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSetStatus(id: string, status: ReviewStatus) {
    setPendingId(id)
    setError(null)
    try {
      await setReviewStatus({ data: { id, status } })
      await router.invalidate()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Reviews"
        subtitle={`${reviews.length} ${reviews.length === 1 ? 'review' : 'reviews'}`}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          to="/admin/reviews"
          search={(prev) => ({ ...prev, status: undefined })}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            !search.status
              ? 'bg-neutral-900 text-white'
              : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
          }`}
        >
          All
        </Link>
        {REVIEW_STATUSES.map((s) => (
          <Link
            key={s}
            to="/admin/reviews"
            search={(prev) => ({ ...prev, status: s })}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
              search.status === s
                ? 'bg-neutral-900 text-white'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          to="/admin/reviews"
          from={Route.fullPath}
          search={(prev) => ({ ...prev, rating: undefined })}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            !search.rating
              ? 'bg-neutral-900 text-white'
              : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
          }`}
        >
          All ratings
        </Link>
        {REVIEW_RATINGS.map((r) => (
          <Link
            key={r}
            to="/admin/reviews"
            from={Route.fullPath}
            search={(prev) => ({ ...prev, rating: r })}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              search.rating === r
                ? 'bg-neutral-900 text-white'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            }`}
          >
            {r} ★
          </Link>
        ))}
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className={tableWrapperClassName}>
        {reviews.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">No reviews found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClassName}>Product</th>
                  <th className={tableHeadClassName}>Customer</th>
                  <th className={tableHeadClassName}>Rating</th>
                  <th className={tableHeadClassName}>Review</th>
                  <th className={tableHeadClassName}>Status</th>
                  <th className={tableHeadClassName}>Date</th>
                  <th className={tableHeadClassName}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((review) => (
                  <tr key={review.id} className={tableRowClassName}>
                    <td className={tableCellClassName}>
                      <Link
                        to="/products/$slug"
                        params={{ slug: review.product.slug }}
                        target="_blank"
                        className="font-medium text-neutral-900 hover:underline"
                      >
                        {review.product.name}
                      </Link>
                      <p className="text-xs text-neutral-400">
                        {review.order?.order_number ??
                          (review.imported_source
                            ? `Imported from ${review.imported_source}`
                            : '—')}
                      </p>
                    </td>
                    <td className={`${tableCellClassName} text-neutral-500`}>
                      <p>{review.customer_name ?? '—'}</p>
                      <p className="text-xs text-neutral-400">
                        {review.customer_email}
                      </p>
                    </td>
                    <td className={tableCellClassName}>
                      <Stars rating={review.rating} />
                    </td>
                    <td className={`${tableCellClassName} max-w-xs`}>
                      {review.review_text && (
                        <p className="line-clamp-3 text-neutral-700">
                          {review.review_text}
                        </p>
                      )}
                      {review.photo_urls.length > 0 && (
                        <div className="mt-1.5 flex gap-1">
                          {review.photo_urls.map((url) => (
                            <img
                              key={url}
                              src={url}
                              alt=""
                              className="size-10 rounded-md border border-neutral-200 object-cover"
                            />
                          ))}
                        </div>
                      )}
                    </td>
                    <td className={tableCellClassName}>
                      <StatusBadge status={review.status} kind="review" />
                    </td>
                    <td className={`${tableCellClassName} text-neutral-500`}>
                      {new Date(review.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className={tableCellClassName}>
                      <div className="flex gap-1.5">
                        {review.status !== 'approved' && (
                          <button
                            type="button"
                            disabled={pendingId === review.id}
                            onClick={() =>
                              handleSetStatus(review.id, 'approved')
                            }
                            className={`${buttonSecondaryClassName} px-2 py-1 text-xs`}
                          >
                            Approve
                          </button>
                        )}
                        {review.status !== 'rejected' && (
                          <button
                            type="button"
                            disabled={pendingId === review.id}
                            onClick={() =>
                              handleSetStatus(review.id, 'rejected')
                            }
                            className={`${buttonSecondaryClassName} px-2 py-1 text-xs`}
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

import { Stars } from '#/components/storefront/Stars'
import type { Review } from '#/types/entities'

export function ProductRatingSummary({
  averageRating,
  reviewCount,
}: {
  averageRating: number
  reviewCount: number
}) {
  if (reviewCount === 0) return null
  return (
    <div className="mt-2 flex items-center gap-2">
      <Stars rating={averageRating} size={15} />
      <span className="text-sm text-neutral-500 dark:text-neutral-400">
        {averageRating.toFixed(1)} ({reviewCount}{' '}
        {reviewCount === 1 ? 'review' : 'reviews'})
      </span>
    </div>
  )
}

export function ProductReviewsList({ reviews }: { reviews: Review[] }) {
  return (
    <div className="mt-6 border-t border-neutral-200 pt-6 dark:border-neutral-800">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Reviews{reviews.length > 0 && ` (${reviews.length})`}
      </h2>
      {reviews.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
          No reviews yet for this product.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-5">
          {reviews.map((review) => (
            <li
              key={review.id}
              className="border-b border-neutral-100 pb-5 last:border-b-0 dark:border-neutral-800"
            >
              <div className="flex items-center justify-between">
                <Stars rating={review.rating} size={14} />
                <span className="text-xs text-neutral-400 dark:text-neutral-500">
                  {new Date(review.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
              <p className="mt-1 text-sm font-medium text-neutral-900 dark:text-white">
                {review.customer_name ?? 'Verified buyer'}
              </p>
              {review.review_text && (
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  {review.review_text}
                </p>
              )}
              {review.photo_urls.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {review.photo_urls.map((url) => (
                    <img
                      key={url}
                      src={url}
                      alt=""
                      className="size-16 rounded-md border border-neutral-200 object-cover dark:border-neutral-700"
                    />
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

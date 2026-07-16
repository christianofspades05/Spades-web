import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { listStorefrontReviews } from '#/server/reviews/queries'
import { submitStoreFeedback } from '#/server/feedback/submit'
import { getErrorMessage } from '#/lib/utils/errors'
import { Stars } from '#/components/storefront/Stars'
import {
  buttonPrimaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/storefront/ui'
import type { StorefrontReview } from '#/server/reviews/queries'

const REVIEWS_PER_PAGE = 5
const ROTATE_INTERVAL_MS = 2000

export const Route = createFileRoute('/reviews/')({
  loader: () => listStorefrontReviews(),
  component: ReviewsPage,
})

function ReviewsPage() {
  const { reviews, averageRating, reviewCount } = Route.useLoaderData()

  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <FeedbackForm />
      <ReviewsCarousel
        reviews={reviews}
        averageRating={averageRating}
        reviewCount={reviewCount}
      />
    </div>
  )
}

function FeedbackForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await submitStoreFeedback({
        data: {
          name: name || undefined,
          email,
          phone: phone || undefined,
          comment: comment || undefined,
        },
      })
      setSubmitted(true)
      setName('')
      setEmail('')
      setPhone('')
      setComment('')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section>
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
        Have any recommendations? Help us improve with your insights
      </h1>

      {submitted ? (
        <p className="mt-6 text-sm text-neutral-600 dark:text-neutral-400">
          Thanks — we appreciate the feedback!
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className={labelClassName}>
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClassName}
              />
            </label>
            <label className={labelClassName}>
              Email *
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClassName}
              />
            </label>
          </div>
          <label className={labelClassName}>
            Phone number
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputClassName}
            />
          </label>
          <label className={labelClassName}>
            Comment
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={5}
              className={inputClassName}
            />
          </label>
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className={buttonPrimaryClassName}
          >
            {submitting ? 'Sending…' : 'Send'}
          </button>
        </form>
      )}
    </section>
  )
}

function ReviewsCarousel({
  reviews,
  averageRating,
  reviewCount,
}: {
  reviews: StorefrontReview[]
  averageRating: number
  reviewCount: number
}) {
  const pages: StorefrontReview[][] = []
  for (let i = 0; i < reviews.length; i += REVIEWS_PER_PAGE) {
    pages.push(reviews.slice(i, i + REVIEWS_PER_PAGE))
  }

  const [pageIndex, setPageIndex] = useState(0)

  useEffect(() => {
    if (pages.length <= 1) return
    const id = setInterval(() => {
      setPageIndex((i) => (i + 1) % pages.length)
    }, ROTATE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [pages.length])

  return (
    <section className="mt-20 text-center">
      <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
        Let customers speak for us
      </h2>
      {reviewCount > 0 && (
        <>
          <div className="mt-3 flex justify-center">
            <Stars rating={averageRating} size={22} />
          </div>
          <p className="mt-1 text-sm text-neutral-500 underline dark:text-neutral-400">
            from {reviewCount} review{reviewCount === 1 ? '' : 's'}
          </p>
        </>
      )}

      {pages.length === 0 ? (
        <p className="mt-10 text-sm text-neutral-500 dark:text-neutral-400">
          No reviews yet — be the first to leave one after your order arrives.
        </p>
      ) : (
        <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-5">
          {pages[pageIndex].map((review) => (
            <Link
              key={review.id}
              to="/products/$slug"
              params={{ slug: review.product.slug }}
              className="flex flex-col items-center gap-2 text-left"
            >
              <div className="flex justify-center">
                <Stars rating={review.rating} />
              </div>
              <p className="text-center text-sm font-medium text-neutral-900 dark:text-white">
                {review.product.name}
              </p>
              <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
                {review.customerName ?? 'Verified buyer'}
              </p>
              {review.product.image && (
                <img
                  src={review.product.image}
                  alt=""
                  className="mt-2 size-16 rounded-md border border-neutral-200 object-cover dark:border-neutral-700"
                />
              )}
            </Link>
          ))}
        </div>
      )}

      {pages.length > 1 && (
        <div className="mt-8 flex justify-center gap-2">
          {pages.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to review page ${i + 1}`}
              onClick={() => setPageIndex(i)}
              className={`size-1.5 rounded-full transition ${
                i === pageIndex
                  ? 'bg-neutral-900 dark:bg-white'
                  : 'bg-neutral-300 dark:bg-neutral-700'
              }`}
            />
          ))}
        </div>
      )}
    </section>
  )
}

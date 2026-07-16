import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Camera, X } from 'lucide-react'
import {
  getReviewRequestByToken,
  submitReviews,
  uploadReviewPhoto,
} from '#/server/reviews/public'
import { fileToBase64 } from '#/lib/utils/file'
import { getErrorMessage } from '#/lib/utils/errors'
import { StarRatingInput } from '#/components/storefront/Stars'
import {
  buttonPrimaryClassName,
  inputClassName,
} from '#/components/storefront/ui'

export const Route = createFileRoute('/review/$token')({
  loader: async ({ params }) =>
    getReviewRequestByToken({ data: { token: params.token } }),
  component: ReviewSubmissionPage,
})

interface ProductReviewDraft {
  rating: number
  reviewText: string
  photoUrls: string[]
  uploading: boolean
}

function initialDrafts(
  products: { id: string }[],
): Record<string, ProductReviewDraft> {
  return Object.fromEntries(
    products.map((p) => [
      p.id,
      { rating: 0, reviewText: '', photoUrls: [], uploading: false },
    ]),
  )
}

function ReviewSubmissionPage() {
  const data = Route.useLoaderData()
  const { token } = Route.useParams()
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, ProductReviewDraft>>(() =>
    initialDrafts(data?.products ?? []),
  )

  if (!data) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">This link isn't valid</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          It may have already been used, or it's expired. If you'd still like to
          leave a review, reach out to us directly.
        </p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">Thanks for your review!</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          We appreciate you taking the time — it'll appear on the product page
          once it's been checked.
        </p>
      </div>
    )
  }

  if (data.products.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">All done!</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          You've already reviewed everything from order {data.orderNumber}.
          Thank you!
        </p>
      </div>
    )
  }

  const products = data.products

  function updateDraft(productId: string, patch: Partial<ProductReviewDraft>) {
    setDrafts((prev) => ({
      ...prev,
      [productId]: { ...prev[productId], ...patch },
    }))
  }

  async function handlePhotoSelect(
    productId: string,
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      setError('Photo must be smaller than 8MB.')
      return
    }

    updateDraft(productId, { uploading: true })
    setError(null)
    try {
      const base64Data = await fileToBase64(file)
      const { url } = await uploadReviewPhoto({
        data: {
          token,
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          base64Data,
        },
      })
      setDrafts((prev) => ({
        ...prev,
        [productId]: {
          ...prev[productId],
          photoUrls: [...prev[productId].photoUrls, url],
          uploading: false,
        },
      }))
    } catch (err) {
      setError(getErrorMessage(err))
      updateDraft(productId, { uploading: false })
    }
  }

  function removePhoto(productId: string, url: string) {
    setDrafts((prev) => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        photoUrls: prev[productId].photoUrls.filter((u) => u !== url),
      },
    }))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    const reviews = products
      .filter((p) => drafts[p.id].rating > 0)
      .map((p) => ({
        productId: p.id,
        rating: drafts[p.id].rating,
        reviewText: drafts[p.id].reviewText.trim() || undefined,
        photoUrls: drafts[p.id].photoUrls,
      }))

    if (reviews.length === 0) {
      setError('Please rate at least one product before submitting.')
      return
    }

    setSubmitting(true)
    try {
      await submitReviews({ data: { token, reviews } })
      setSubmitted(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight">
        {data.customerName
          ? `How was it, ${data.customerName.split(' ')[0]}?`
          : 'How was your order?'}
      </h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        Rate and review the items from order {data.orderNumber}. Only products
        you rate will be submitted.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-8">
        {products.map((product) => {
          const draft = drafts[product.id]
          return (
            <div
              key={product.id}
              className="rounded-lg border border-neutral-200 p-5 dark:border-neutral-800"
            >
              <div className="flex items-center gap-3">
                {product.image ? (
                  <img
                    src={product.image}
                    alt=""
                    className="size-14 rounded-md border border-neutral-200 object-cover dark:border-neutral-700"
                  />
                ) : (
                  <div className="size-14 rounded-md border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900" />
                )}
                <p className="font-semibold text-neutral-900 dark:text-white">
                  {product.name}
                </p>
              </div>

              <div className="mt-4">
                <StarRatingInput
                  value={draft.rating}
                  onChange={(rating) => updateDraft(product.id, { rating })}
                />
              </div>

              <textarea
                value={draft.reviewText}
                onChange={(e) =>
                  updateDraft(product.id, { reviewText: e.target.value })
                }
                placeholder="Tell us what you think (optional)"
                rows={3}
                maxLength={5000}
                className={`${inputClassName} mt-3 w-full`}
              />

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {draft.photoUrls.map((url) => (
                  <div key={url} className="relative">
                    <img
                      src={url}
                      alt=""
                      className="size-16 rounded-md border border-neutral-200 object-cover dark:border-neutral-700"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(product.id, url)}
                      className="absolute -top-1.5 -right-1.5 rounded-full bg-neutral-900 p-0.5 text-white"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {draft.photoUrls.length < 5 && (
                  <label className="flex size-16 cursor-pointer items-center justify-center rounded-md border border-dashed border-neutral-300 text-neutral-400 hover:border-neutral-500 dark:border-neutral-700 dark:hover:border-neutral-500">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={draft.uploading}
                      onChange={(e) => handlePhotoSelect(product.id, e)}
                    />
                    <Camera size={18} />
                  </label>
                )}
              </div>
            </div>
          )
        })}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className={`${buttonPrimaryClassName} justify-center`}
        >
          {submitting ? 'Submitting…' : 'Submit review'}
        </button>
      </form>
    </div>
  )
}

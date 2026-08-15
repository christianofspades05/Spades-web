import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  cancelTrackedOrder,
  getOrderForTracking,
} from '#/server/storefront/order-tracking'
import { formatCents } from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
} from '#/components/storefront/ui'

export const Route = createFileRoute('/track/$orderId')({
  loader: ({ params }) =>
    getOrderForTracking({ data: { orderId: params.orderId } }),
  component: TrackOrderPage,
})

function TrackOrderPage() {
  const order = Route.useLoaderData()
  const { orderId } = Route.useParams()
  const router = useRouter()

  if (!order) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">Order not found</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          This tracking link doesn't match any order — double check the link
          from your confirmation email, or contact us if you think this is a
          mistake.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight">
        Order {order.orderNumber}
      </h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Placed{' '}
        {new Date(order.placedAt).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })}
      </p>

      {order.status === 'cancelled' ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          This order was cancelled.
          {order.cancellationDetail && (
            <span className="mt-1 block text-red-700 dark:text-red-400">
              {order.cancellationDetail}
            </span>
          )}
        </div>
      ) : (
        <p className="mt-2 inline-block rounded-full bg-neutral-100 px-3 py-1 text-sm font-medium text-neutral-700 capitalize dark:bg-neutral-800 dark:text-neutral-300">
          {order.status.replace(/_/g, ' ')}
        </p>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-500 uppercase dark:text-neutral-400">
          Items
        </h2>
        <ul className="mt-3 flex flex-col gap-3">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-center gap-3">
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt=""
                  className="size-12 shrink-0 rounded-md object-cover"
                />
              ) : (
                <div className="size-12 shrink-0 rounded-md bg-neutral-200 dark:bg-neutral-800" />
              )}
              <span className="text-sm text-neutral-700 dark:text-neutral-300">
                {item.name}
                {item.variantLabel && ` — ${item.variantLabel}`}
                {item.quantity > 1 && ` ×${item.quantity}`}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-right text-sm font-semibold text-neutral-900 dark:text-white">
          Total: {formatCents(order.totalCents, order.currency)}
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-500 uppercase dark:text-neutral-400">
          Shipping
        </h2>
        {order.isFulfilled ? (
          <div className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
            {order.trackingNumber && (
              <p>
                {order.carrier ? `${order.carrier} — ` : ''}
                {order.trackingNumber}
              </p>
            )}
            {order.trackingUrl && (
              <a
                href={order.trackingUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block font-medium text-neutral-900 underline dark:text-white"
              >
                Track package
              </a>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            Not shipped yet.
          </p>
        )}
      </section>

      {order.canCancel && (
        <div className="mt-8">
          <CancelOrderButton
            orderId={orderId}
            onCancelled={() => router.invalidate()}
          />
        </div>
      )}
    </div>
  )
}

function CancelOrderButton({
  orderId,
  onCancelled,
}: {
  orderId: string
  onCancelled: () => void
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleClose() {
    setOpen(false)
    setReason('')
    setError(null)
  }

  async function handleConfirm() {
    if (!reason.trim()) {
      setError('Please tell us why you want to cancel this order.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await cancelTrackedOrder({ data: { orderId, reason: reason.trim() } })
      onCancelled()
    } catch (err) {
      setError(getErrorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonSecondaryClassName}
      >
        Cancel order
      </button>

      {open && (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 text-left shadow-xl dark:bg-neutral-900">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
              Cancel this order?
            </h2>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              This can't be undone. Let us know why you're cancelling.
            </p>

            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for cancelling"
              rows={3}
              autoFocus
              className={`${inputClassName} mt-4 w-full resize-none`}
            />

            {error && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={submitting}
                className={buttonSecondaryClassName}
              >
                Never mind
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirm}
                className={buttonPrimaryClassName}
              >
                {submitting ? 'Cancelling…' : 'Confirm cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

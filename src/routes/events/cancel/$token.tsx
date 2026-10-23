import { useState } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'
import {
  cancelRegistrationByToken,
  getCancelInfoByToken,
} from '#/server/events/cancel'
import { getErrorMessage } from '#/lib/utils/errors'
import { buttonPrimaryClassName } from '#/components/storefront/ui'

/** Matches $slug.tsx's own formatter — each event page inlines this rather
 *  than sharing a util, same existing convention in this codebase. */
function formatEventSchedule(startsAtIso: string, endsAtIso: string): string {
  const start = new Date(startsAtIso)
  const end = new Date(endsAtIso)
  const dateOpts = {
    dateStyle: 'full',
    timeZone: 'Asia/Manila',
  } satisfies Intl.DateTimeFormatOptions
  const timeOpts = {
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  } satisfies Intl.DateTimeFormatOptions

  const startDate = start.toLocaleDateString('en-US', dateOpts)
  const endDate = end.toLocaleDateString('en-US', dateOpts)
  const startTime = start.toLocaleTimeString('en-US', timeOpts)
  const endTime = end.toLocaleTimeString('en-US', timeOpts)

  return startDate === endDate
    ? `${startDate}, ${startTime} – ${endTime}`
    : `${startDate}, ${startTime} – ${endDate}, ${endTime}`
}

export const Route = createFileRoute('/events/cancel/$token')({
  loader: async ({ params }) => {
    const info = await getCancelInfoByToken({ data: { token: params.token } })
    if (!info) throw notFound()
    return { info, token: params.token }
  },
  component: CancelRegistrationPage,
})

function CancelRegistrationPage() {
  const { info, token } = Route.useLoaderData()
  const [cancelled, setCancelled] = useState(info.alreadyCancelled)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCancel() {
    setSubmitting(true)
    setError(null)
    try {
      await cancelRegistrationByToken({ data: { token } })
      setCancelled(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">
        {info.eventName}
      </h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        {formatEventSchedule(info.startsAt, info.endsAt)}
      </p>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        {info.locationName}
      </p>

      <div className="mt-8 rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
        {cancelled ? (
          <p className="text-neutral-900 dark:text-neutral-50">
            Your slot has been cancelled. Hope to see you at a future event!
          </p>
        ) : (
          <>
            <p className="text-neutral-900 dark:text-neutral-50">
              Hi {info.fullName}, cancel your slot for this event?
            </p>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleCancel()}
              className={`${buttonPrimaryClassName} mt-4 w-full justify-center`}
            >
              {submitting ? 'Cancelling…' : 'Yes, cancel my slot'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

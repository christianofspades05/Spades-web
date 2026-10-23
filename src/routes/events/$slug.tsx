import { useState } from 'react'
import { z } from 'zod'
import { createFileRoute, notFound } from '@tanstack/react-router'
import {
  getEventBySlug,
  listEventParticipantNames,
} from '#/server/events/queries'
import { registerForEvent } from '#/server/events/register'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import { STOREFRONT_CACHE_HEADERS } from '#/lib/utils/cache-control'
import {
  buttonPrimaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/storefront/ui'

/** "Thursday, October 29, 2026, 9:00 PM – 11:00 PM" when start/end share a
 *  PH-local calendar day (the common case); spells out the end date too
 *  once an event crosses midnight. */
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

export const Route = createFileRoute('/events/$slug')({
  headers: () => STOREFRONT_CACHE_HEADERS,
  validateSearch: z.object({
    registered: z.string().optional(),
    paymentFailed: z.boolean().optional(),
  }),
  loader: async ({ context, params }) => {
    if (context.storefrontScope.brand !== 'spades') throw notFound()
    const event = await getEventBySlug({ data: { slug: params.slug } })
    if (!event) throw notFound()
    const participantNames = await listEventParticipantNames({
      data: { eventId: event.id },
    })
    return { event, participantNames }
  },
  component: EventDetailPage,
})

function EventDetailPage() {
  const { event, participantNames } = Route.useLoaderData()
  const search = Route.useSearch()
  const soldOut = event.slots_reserved >= event.total_slots
  const slotsAvailable = Math.max(event.total_slots - event.slots_reserved, 0)

  const [fullName, setFullName] = useState('')
  const [age, setAge] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(Boolean(search.registered))

  async function handleSubmit(formEvent: React.FormEvent) {
    formEvent.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const result = await registerForEvent({
        data: {
          eventId: event.id,
          fullName,
          age: Number(age),
          email,
          phone,
        },
      })
      if (result.invoiceUrl) {
        window.location.href = result.invoiceUrl
        return
      }
      setConfirmed(true)
    } catch (err) {
      setError(getErrorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {event.image_url && (
            <img
              src={event.image_url}
              alt=""
              className="mb-8 aspect-square w-full rounded-lg object-cover"
            />
          )}

          <h1 className="text-3xl font-semibold text-neutral-900 dark:text-neutral-50">
            {event.name}
          </h1>

          <div className="mt-4 space-y-1 text-neutral-600 dark:text-neutral-400">
            <p>{formatEventSchedule(event.starts_at, event.ends_at)}</p>
            <p>
              {event.location_name}
              {event.location_map_url && (
                <>
                  {' — '}
                  <a
                    href={event.location_map_url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    View on map
                  </a>
                </>
              )}
            </p>
            <p className="font-medium text-neutral-900 dark:text-neutral-50">
              {event.fee_cents === 0
                ? 'Free'
                : formatCentsAsPHP(event.fee_cents)}
            </p>
            <p className={soldOut ? 'text-red-600' : ''}>
              {soldOut
                ? 'Fully booked'
                : `${slotsAvailable} of ${event.total_slots} slots available`}
            </p>
          </div>

          <div className="mt-10 rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
            {confirmed ? (
              <p className="text-neutral-900 dark:text-neutral-50">
                You're registered! Check your email for confirmation.
              </p>
            ) : search.paymentFailed ? (
              <>
                <p className="mb-4 text-sm text-red-600">
                  Payment didn't go through — you can try registering again
                  below.
                </p>
                <RegistrationForm
                  soldOut={soldOut}
                  fullName={fullName}
                  setFullName={setFullName}
                  age={age}
                  setAge={setAge}
                  email={email}
                  setEmail={setEmail}
                  phone={phone}
                  setPhone={setPhone}
                  submitting={submitting}
                  error={error}
                  onSubmit={handleSubmit}
                  feeCents={event.fee_cents}
                />
              </>
            ) : soldOut ? (
              <p className="text-neutral-500">
                This event is fully booked — check back in case a slot opens up.
              </p>
            ) : (
              <RegistrationForm
                soldOut={soldOut}
                fullName={fullName}
                setFullName={setFullName}
                age={age}
                setAge={setAge}
                email={email}
                setEmail={setEmail}
                phone={phone}
                setPhone={setPhone}
                submitting={submitting}
                error={error}
                onSubmit={handleSubmit}
                feeCents={event.fee_cents}
              />
            )}
          </div>
        </div>

        <ParticipantsList names={participantNames} />
      </div>
    </div>
  )
}

function ParticipantsList({ names }: { names: string[] }) {
  return (
    <aside className="lg:col-span-1">
      <div className="rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          Meet community participants
        </h2>
        {names.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">
            No one's confirmed yet — be the first to join.
          </p>
        ) : (
          <ol className="mt-4 space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
            {names.map((name, i) => (
              <li key={`${name}-${i}`} className="flex gap-2">
                <span className="text-neutral-400 dark:text-neutral-600">
                  {i + 1}.
                </span>
                <span>{name}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  )
}

function RegistrationForm({
  fullName,
  setFullName,
  age,
  setAge,
  email,
  setEmail,
  phone,
  setPhone,
  submitting,
  error,
  onSubmit,
  feeCents,
}: {
  soldOut: boolean
  fullName: string
  setFullName: (v: string) => void
  age: string
  setAge: (v: string) => void
  email: string
  setEmail: (v: string) => void
  phone: string
  setPhone: (v: string) => void
  submitting: boolean
  error: string | null
  onSubmit: (event: React.FormEvent) => void
  feeCents: number
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-50">
        Reserve your slot
      </h2>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div>
        <label className={labelClassName}>Full name</label>
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          className={`${inputClassName} w-full`}
        />
      </div>

      <div>
        <label className={labelClassName}>Age</label>
        <input
          type="number"
          min={0}
          max={130}
          value={age}
          onChange={(e) => setAge(e.target.value)}
          required
          className={`${inputClassName} w-full`}
        />
      </div>

      <div>
        <label className={labelClassName}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className={`${inputClassName} w-full`}
        />
      </div>

      <div>
        <label className={labelClassName}>Phone</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          className={`${inputClassName} w-full`}
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className={`${buttonPrimaryClassName} w-full`}
      >
        {submitting
          ? 'Please wait…'
          : feeCents === 0
            ? 'Reserve my slot'
            : `Pay ${formatCentsAsPHP(feeCents)} & reserve`}
      </button>
    </form>
  )
}

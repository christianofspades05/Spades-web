import { useState } from 'react'
import { z } from 'zod'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { getEventBySlug } from '#/server/events/queries'
import { registerForEvent } from '#/server/events/register'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import { STOREFRONT_CACHE_HEADERS } from '#/lib/utils/cache-control'
import {
  buttonPrimaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/storefront/ui'

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
    return { event }
  },
  component: EventDetailPage,
})

function EventDetailPage() {
  const { event } = Route.useLoaderData()
  const search = Route.useSearch()
  const soldOut = event.slots_reserved >= event.total_slots

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
          phone: phone || undefined,
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
    <div className="mx-auto max-w-2xl px-6 py-16">
      {event.image_url && (
        <img
          src={event.image_url}
          alt=""
          className="mb-8 h-64 w-full rounded-lg object-cover"
        />
      )}

      <h1 className="text-3xl font-semibold text-neutral-900 dark:text-neutral-50">
        {event.name}
      </h1>

      <div className="mt-4 space-y-1 text-neutral-600 dark:text-neutral-400">
        <p>
          {new Date(event.starts_at).toLocaleString('en-US', {
            dateStyle: 'full',
            timeStyle: 'short',
            timeZone: 'Asia/Manila',
          })}
        </p>
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
          {event.fee_cents === 0 ? 'Free' : formatCentsAsPHP(event.fee_cents)}
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
              Payment didn't go through — you can try registering again below.
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
        <label className={labelClassName}>Phone (optional)</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
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

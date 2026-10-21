import { useState } from 'react'
import { z } from 'zod'
import {
  createFileRoute,
  notFound,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import {
  addEventRegistration,
  getEventById,
  getEventRegistrationsCount,
  listEventRegistrations,
  updateEvent,
} from '#/server/admin/events'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import { PageHeader } from '#/components/admin/PageHeader'
import { Badge } from '#/components/admin/Badge'
import { Card } from '#/components/admin/Card'
import { EventForm } from '#/components/admin/EventForm'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
  labelClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'
import type { EventInput } from '#/lib/validation/events'
import type { EventRegistrationStatus } from '#/types/community-events'

const PAGE_SIZE = 20

export const Route = createFileRoute('/admin/community/$eventId')({
  validateSearch: z.object({
    regPage: z.number().int().min(1).catch(1),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }) => {
    const event = await getEventById({ data: { id: params.eventId } })
    if (!event) throw notFound()
    const [registrations, { total: registrationsTotal }] = await Promise.all([
      listEventRegistrations({
        data: { eventId: params.eventId, page: deps.regPage },
      }),
      getEventRegistrationsCount({ data: { eventId: params.eventId } }),
    ])
    return { event, registrations, registrationsTotal }
  },
  component: EditEventPage,
})

const STATUS_TONE: Record<
  EventRegistrationStatus,
  'success' | 'info' | 'neutral'
> = {
  pending: 'info',
  confirmed: 'success',
  released: 'neutral',
}

function EditEventPage() {
  const { event, registrations, registrationsTotal } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()

  const [showAddForm, setShowAddForm] = useState(false)

  const page = search.regPage
  const totalPages = Math.max(1, Math.ceil(registrationsTotal / PAGE_SIZE))

  async function handleSubmit(data: EventInput) {
    await updateEvent({ data: { ...data, id: event.id } })
    // Route loaders are cached — without invalidating, this same page
    // would keep showing the pre-edit values right after saving.
    await router.invalidate()
    await navigate({ to: '/admin/community' })
  }

  return (
    <div className="w-full max-w-2xl px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title={`Edit ${event.name}`}
        subtitle={`${event.slots_reserved} / ${event.total_slots} slots reserved`}
      />
      <EventForm
        event={event}
        onSubmit={handleSubmit}
        submitLabel="Save changes"
      />

      <div className="mt-10 mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900">
          Registrations ({registrationsTotal})
        </h2>
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className={buttonSecondaryClassName}
        >
          {showAddForm ? 'Cancel' : 'Add registrant'}
        </button>
      </div>

      {showAddForm && (
        <AddRegistrantForm
          eventId={event.id}
          onAdded={async () => {
            setShowAddForm(false)
            await router.invalidate()
          }}
        />
      )}

      <div className={tableWrapperClassName}>
        {registrations.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">
            No one has registered yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClassName}>Name</th>
                  <th className={tableHeadClassName}>Age</th>
                  <th className={tableHeadClassName}>Email</th>
                  <th className={tableHeadClassName}>Phone</th>
                  <th className={tableHeadClassName}>Status</th>
                  <th className={`${tableHeadClassName} text-right`}>Fee</th>
                  <th className={tableHeadClassName}>Registered</th>
                </tr>
              </thead>
              <tbody>
                {registrations.map((reg) => (
                  <tr key={reg.id} className={tableRowClassName}>
                    <td className={`${tableCellClassName} font-medium`}>
                      {reg.full_name}
                    </td>
                    <td className={`${tableCellClassName} text-neutral-500`}>
                      {reg.age}
                    </td>
                    <td className={`${tableCellClassName} text-neutral-500`}>
                      {reg.email}
                    </td>
                    <td className={`${tableCellClassName} text-neutral-500`}>
                      {reg.phone ?? '—'}
                    </td>
                    <td className={tableCellClassName}>
                      <Badge tone={STATUS_TONE[reg.status]}>{reg.status}</Badge>
                    </td>
                    <td className={`${tableCellClassName} text-right`}>
                      {reg.fee_cents === 0
                        ? 'Free'
                        : formatCentsAsPHP(reg.fee_cents)}
                    </td>
                    <td className={`${tableCellClassName} text-neutral-500`}>
                      {new Date(reg.created_at).toLocaleString('en-US', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                        timeZone: 'Asia/Manila',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {registrationsTotal > 0 && (
        <Card className="mt-3 flex items-center justify-between gap-3 p-3 text-sm text-neutral-500">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() =>
                navigate({
                  search: (prev) => ({ ...prev, regPage: page - 1 }),
                })
              }
              className={`${buttonSecondaryClassName} ${page <= 1 ? 'pointer-events-none opacity-40' : ''}`}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() =>
                navigate({
                  search: (prev) => ({ ...prev, regPage: page + 1 }),
                })
              }
              className={`${buttonSecondaryClassName} ${page >= totalPages ? 'pointer-events-none opacity-40' : ''}`}
            >
              Next
            </button>
          </div>
        </Card>
      )}
    </div>
  )
}

function AddRegistrantForm({
  eventId,
  onAdded,
}: {
  eventId: string
  onAdded: () => Promise<void>
}) {
  const [fullName, setFullName] = useState('')
  const [age, setAge] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(formEvent: React.FormEvent) {
    formEvent.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await addEventRegistration({
        data: {
          eventId,
          fullName,
          age: Number(age),
          email,
          phone: phone || undefined,
        },
      })
      await onAdded()
    } catch (err) {
      setError(getErrorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <Card className="mb-4 p-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
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
        </div>
        <p className="text-xs text-neutral-500">
          Confirmed immediately (no payment flow) — use this for
          offline/walk-in/comped signups. Counts against the slot cap like any
          other registration.
        </p>
        <button
          type="submit"
          disabled={submitting}
          className={buttonPrimaryClassName}
        >
          {submitting ? 'Adding…' : 'Add registrant'}
        </button>
      </form>
    </Card>
  )
}

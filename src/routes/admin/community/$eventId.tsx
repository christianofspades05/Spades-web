import { useRef, useState } from 'react'
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
  listCheckedInNames,
  listEventRegistrations,
  removeEventRegistration,
  searchCreatorsForPicker,
  searchStaffForPicker,
  sendEventReminders,
  setRegistrationAttendance,
  updateEvent,
} from '#/server/admin/events'
import type {
  CreatorPickerResult,
  StaffPickerResult,
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
    q: z.string().optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }) => {
    const event = await getEventById({ data: { id: params.eventId } })
    if (!event) throw notFound()
    const [registrations, { total: registrationsTotal }] = await Promise.all([
      listEventRegistrations({
        data: { eventId: params.eventId, page: deps.regPage, q: deps.q },
      }),
      getEventRegistrationsCount({
        data: { eventId: params.eventId, q: deps.q },
      }),
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
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [attendanceMode, setAttendanceMode] = useState(false)
  const [attendingId, setAttendingId] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState(search.q ?? '')
  const [sendingReminders, setSendingReminders] = useState(false)
  const [reminderResult, setReminderResult] = useState<string | null>(null)
  const [copyingList, setCopyingList] = useState(false)
  const [copyResult, setCopyResult] = useState<string | null>(null)
  const [copyText, setCopyText] = useState<string | null>(null)

  const page = search.regPage
  const totalPages = Math.max(1, Math.ceil(registrationsTotal / PAGE_SIZE))

  async function handleSubmit(data: EventInput) {
    await updateEvent({ data: { ...data, id: event.id } })
    // Route loaders are cached — without invalidating, this same page
    // would keep showing the pre-edit values right after saving.
    await router.invalidate()
    await navigate({ to: '/admin/community' })
  }

  async function handleRemove(registrationId: string, fullName: string) {
    if (
      !confirm(`Remove ${fullName}? This gives their slot back to the event.`)
    ) {
      return
    }
    setRemovingId(registrationId)
    try {
      await removeEventRegistration({ data: { registrationId } })
      await router.invalidate()
    } finally {
      setRemovingId(null)
    }
  }

  async function handleToggleAttendance(registrationId: string, next: boolean) {
    setAttendingId(registrationId)
    try {
      await setRegistrationAttendance({
        data: { registrationId, attended: next },
      })
      await router.invalidate()
    } finally {
      setAttendingId(null)
    }
  }

  async function handleCopyAttendeeList() {
    setCopyingList(true)
    setCopyResult(null)
    setCopyText(null)
    try {
      const names = await listCheckedInNames({ data: { eventId: event.id } })
      if (names.length === 0) {
        setCopyResult('No one is checked in yet.')
        return
      }
      const text = names.map((name, i) => `${i + 1}. ${name}`).join('\n')
      try {
        await navigator.clipboard.writeText(text)
        setCopyResult(
          `Copied ${names.length} name${names.length === 1 ? '' : 's'}.`,
        )
      } catch {
        setCopyResult(
          "Couldn't copy automatically — select and copy the list below.",
        )
        setCopyText(text)
      }
    } finally {
      setCopyingList(false)
    }
  }

  function handleSearchSubmit(formEvent: React.FormEvent) {
    formEvent.preventDefault()
    navigate({
      search: (prev) => ({ ...prev, q: searchInput || undefined, regPage: 1 }),
    })
  }

  async function handleSendReminders() {
    if (
      !confirm(
        `Email a "today's the day" reminder (with a cancel-my-slot link) to every confirmed registrant with an email on file?`,
      )
    ) {
      return
    }
    setSendingReminders(true)
    setReminderResult(null)
    try {
      const result = await sendEventReminders({ data: { eventId: event.id } })
      setReminderResult(
        `Sent ${result.sent}${result.failed > 0 ? `, ${result.failed} failed` : ''}${result.skippedNoEmail > 0 ? `, ${result.skippedNoEmail} skipped (no email)` : ''}.`,
      )
    } finally {
      setSendingReminders(false)
    }
  }

  return (
    <div className="w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title={`Edit ${event.name}`}
        subtitle={`${event.slots_reserved} / ${event.total_slots} slots reserved`}
      />
      <div className="max-w-2xl">
        <EventForm
          event={event}
          onSubmit={handleSubmit}
          submitLabel="Save changes"
        />
      </div>

      <div className="mt-10 mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-900">
          Registrations ({registrationsTotal})
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <form
            onSubmit={handleSearchSubmit}
            className="flex items-center gap-2"
          >
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search names"
              className={inputClassName}
            />
            <button type="submit" className={buttonSecondaryClassName}>
              Search
            </button>
          </form>
          <button
            type="button"
            disabled={sendingReminders}
            onClick={() => void handleSendReminders()}
            className={buttonSecondaryClassName}
          >
            {sendingReminders ? 'Sending…' : 'Send reminders'}
          </button>
          <button
            type="button"
            onClick={() => setAttendanceMode((v) => !v)}
            className={buttonSecondaryClassName}
          >
            {attendanceMode ? 'Done' : 'Start attendance'}
          </button>
          <button
            type="button"
            disabled={copyingList}
            onClick={() => void handleCopyAttendeeList()}
            className={buttonSecondaryClassName}
          >
            {copyingList ? 'Copying…' : 'Copy attendee list'}
          </button>
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className={buttonSecondaryClassName}
          >
            {showAddForm ? 'Done' : 'Add registrant'}
          </button>
        </div>
      </div>

      {reminderResult && (
        <p className="mb-3 text-sm text-neutral-500">{reminderResult}</p>
      )}
      {copyResult && (
        <p className="mb-3 text-sm text-neutral-500">{copyResult}</p>
      )}
      {copyText && (
        <textarea
          readOnly
          value={copyText}
          onFocus={(e) => e.target.select()}
          rows={6}
          className={`${inputClassName} mb-3 w-full`}
        />
      )}

      {showAddForm && (
        <AddRegistrantForm
          eventId={event.id}
          // Stays open after each add (doesn't close/reset to the list)
          // so staff can add several people in a row without reopening
          // the form each time — just Cancel/Done when finished.
          onAdded={async () => {
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
                  {attendanceMode && (
                    <th className={tableHeadClassName}>Attended</th>
                  )}
                  <th className={tableHeadClassName}></th>
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
                      {reg.email ?? '—'}
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
                    {attendanceMode && (
                      <td className={tableCellClassName}>
                        {reg.status !== 'released' && (
                          <input
                            type="checkbox"
                            checked={Boolean(reg.checked_in_at)}
                            disabled={attendingId === reg.id}
                            onChange={(e) =>
                              void handleToggleAttendance(
                                reg.id,
                                e.target.checked,
                              )
                            }
                          />
                        )}
                      </td>
                    )}
                    <td className={`${tableCellClassName} text-right`}>
                      {reg.status !== 'released' && (
                        <button
                          type="button"
                          disabled={removingId === reg.id}
                          onClick={() =>
                            void handleRemove(reg.id, reg.full_name)
                          }
                          className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-40"
                        >
                          {removingId === reg.id ? 'Removing…' : 'Remove'}
                        </button>
                      )}
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
  const [addedNames, setAddedNames] = useState<string[]>([])
  const fullNameInputRef = useRef<HTMLInputElement>(null)

  const [pickerMode, setPickerMode] = useState<'none' | 'creators' | 'staff'>(
    'none',
  )
  const [pickerQuery, setPickerQuery] = useState('')
  const [creatorResults, setCreatorResults] = useState<CreatorPickerResult[]>(
    [],
  )
  const [staffResults, setStaffResults] = useState<StaffPickerResult[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)

  async function openPicker(mode: 'creators' | 'staff') {
    setPickerMode(mode)
    setPickerQuery('')
    setPickerLoading(true)
    try {
      if (mode === 'creators') {
        setCreatorResults(await searchCreatorsForPicker({ data: {} }))
      } else {
        setStaffResults(await searchStaffForPicker({ data: {} }))
      }
    } finally {
      setPickerLoading(false)
    }
  }

  async function handlePickerSearch(formEvent: React.FormEvent) {
    formEvent.preventDefault()
    if (pickerMode === 'none') return
    setPickerLoading(true)
    try {
      if (pickerMode === 'creators') {
        setCreatorResults(
          await searchCreatorsForPicker({ data: { q: pickerQuery } }),
        )
      } else {
        setStaffResults(
          await searchStaffForPicker({ data: { q: pickerQuery } }),
        )
      }
    } finally {
      setPickerLoading(false)
    }
  }

  function pickResult(name: string, pickedEmail: string | null) {
    setFullName(name)
    setEmail(pickedEmail ?? '')
    setPickerMode('none')
  }

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
          email: email || undefined,
          phone: phone || undefined,
        },
      })
      // Stays open and clears for the next person instead of closing —
      // addedNames is just a running "who've I added this round" list so
      // it's obvious each click is landing, since the form resets right
      // out from under what staff just typed.
      setAddedNames((names) => [...names, fullName])
      setFullName('')
      setAge('')
      setEmail('')
      setPhone('')
      fullNameInputRef.current?.focus()
      await onAdded()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs font-medium text-neutral-500">
          Quick add from:
        </span>
        <button
          type="button"
          onClick={() => void openPicker('creators')}
          className={buttonSecondaryClassName}
        >
          Influencer
        </button>
        <button
          type="button"
          onClick={() => void openPicker('staff')}
          className={buttonSecondaryClassName}
        >
          Spades staff
        </button>
      </div>

      {pickerMode !== 'none' && (
        <Card className="mb-3 p-3">
          <form
            onSubmit={handlePickerSearch}
            className="mb-2 flex items-center gap-2"
          >
            <input
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder={
                pickerMode === 'creators'
                  ? 'Search influencers'
                  : 'Search staff'
              }
              className={`${inputClassName} flex-1`}
            />
            <button type="submit" className={buttonSecondaryClassName}>
              {pickerLoading ? 'Searching…' : 'Search'}
            </button>
            <button
              type="button"
              onClick={() => setPickerMode('none')}
              className={buttonSecondaryClassName}
            >
              Close
            </button>
          </form>
          <ul className="max-h-48 divide-y divide-neutral-100 overflow-y-auto">
            {(pickerMode === 'creators' ? creatorResults : staffResults)
              .length === 0 && !pickerLoading ? (
              <li className="py-2 text-sm text-neutral-500">No matches.</li>
            ) : (
              (pickerMode === 'creators' ? creatorResults : staffResults).map(
                (result) => (
                  <li key={result.id}>
                    <button
                      type="button"
                      onClick={() => pickResult(result.name, result.email)}
                      className="flex w-full items-center justify-between py-2 text-left text-sm hover:bg-neutral-50"
                    >
                      <span className="font-medium text-neutral-900">
                        {result.name}
                      </span>
                      <span className="text-neutral-500">
                        {result.email || '—'}
                      </span>
                    </button>
                  </li>
                ),
              )
            )}
          </ul>
        </Card>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClassName}>Full name</label>
            <input
              ref={fullNameInputRef}
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
            <label className={labelClassName}>Email (optional)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className={buttonPrimaryClassName}
          >
            {submitting ? 'Adding…' : 'Add registrant'}
          </button>
          {addedNames.length > 0 && (
            <p className="text-xs text-neutral-500">
              Added {addedNames.length} so far: {addedNames.join(', ')}
            </p>
          )}
        </div>
      </form>
    </Card>
  )
}

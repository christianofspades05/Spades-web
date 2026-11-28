import { useState } from 'react'
import { Plus } from 'lucide-react'
import { z } from 'zod'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import {
  deleteAttendanceEntry,
  getTeamAttendance,
  saveAttendanceEntry,
} from '#/server/admin/attendance'
import type { TeamAttendanceRow } from '#/server/admin/attendance'
import { getErrorMessage } from '#/lib/utils/errors'
import {
  DATE_RANGE_PRESETS,
  resolveDateRange,
  utcIsoToStoreLocalDateTimeInput,
} from '#/lib/utils/date-range'
import {
  formatManilaDate,
  formatManilaTime,
  formatMinutes,
} from '#/lib/payroll/format'
import {
  ATTENDANCE_PAGE_CLASS,
  AttendanceTabs,
  OwnerOnlyError,
} from '#/components/admin/AttendanceTabs'
import { Badge } from '#/components/admin/Badge'
import { Card } from '#/components/admin/Card'
import { DateRangePicker } from '#/components/admin/DateRangePicker'
import { PageHeader } from '#/components/admin/PageHeader'
import {
  buttonDangerClassName,
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
  labelClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

export const Route = createFileRoute('/admin/attendance/team')({
  validateSearch: z.object({
    range: z.enum(DATE_RANGE_PRESETS).catch('last_7_days'),
    from: z.string().optional(),
    to: z.string().optional(),
    staff: z.string().uuid().optional().catch(undefined),
    flagged: z.boolean().catch(false),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const range = resolveDateRange(deps.range, { from: deps.from, to: deps.to })
    const data = await getTeamAttendance({
      data: {
        from: range.from,
        to: range.to,
        employeeId: deps.staff,
        flaggedOnly: deps.flagged,
      },
    })
    return { ...data, range }
  },
  component: TeamPage,
  errorComponent: OwnerOnlyError,
})

interface EditState {
  id?: string
  employeeId: string
  clockIn: string
  clockOut: string
  breakMinutes: string
  note: string
}

function TeamPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [edit, setEdit] = useState<EditState | null>(null)
  const [viewPhoto, setViewPhoto] = useState<{
    url: string
    caption: string
  } | null>(null)

  const activeEmployees = data.employees.filter((e) => e.is_active)

  function startAdd() {
    const today = utcIsoToStoreLocalDateTimeInput(
      new Date().toISOString(),
    ).slice(0, 10)
    setEdit({
      employeeId: activeEmployees[0]?.id ?? '',
      clockIn: `${today}T09:00`,
      clockOut: `${today}T18:00`,
      breakMinutes: '',
      note: '',
    })
  }

  function startEdit(row: TeamAttendanceRow, closing = false) {
    setEdit({
      id: row.id,
      employeeId: row.employee_id,
      clockIn: utcIsoToStoreLocalDateTimeInput(row.clock_in_at),
      clockOut: row.clock_out_at
        ? utcIsoToStoreLocalDateTimeInput(row.clock_out_at)
        : closing
          ? `${row.work_date}T18:00`
          : '',
      breakMinutes: row.break_minutes === null ? '' : String(row.break_minutes),
      note: '',
    })
  }

  return (
    <div className={ATTENDANCE_PAGE_CLASS}>
      <h1 className="mb-4 text-lg font-semibold text-neutral-900 md:hidden">
        Team attendance
      </h1>
      <div className="hidden md:block">
        <PageHeader
          title="Attendance & Payroll"
          action={
            <button
              type="button"
              className={buttonPrimaryClassName}
              onClick={startAdd}
            >
              Add shift
            </button>
          }
        />
      </div>
      {/* Phones: floating add button above the bottom tab bar. */}
      <button
        type="button"
        onClick={startAdd}
        aria-label="Add shift"
        className="fixed right-4 bottom-20 z-30 flex size-14 items-center justify-center rounded-full bg-neutral-900 text-white shadow-lg active:scale-95 md:hidden"
      >
        <Plus size={26} />
      </button>
      <AttendanceTabs active="team" isOwner />
      {viewPhoto && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 p-4"
          onClick={() => setViewPhoto(null)}
        >
          <img
            src={viewPhoto.url}
            alt={viewPhoto.caption}
            className="max-h-[80vh] max-w-full rounded-xl object-contain"
          />
          <p className="text-sm text-white">{viewPhoto.caption}</p>
          <p className="text-xs text-neutral-400">Tap anywhere to close</p>
        </div>
      )}

      <Card className="mb-6 p-4">
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">
          On shift now
        </h2>
        {data.onShiftNow.length === 0 ? (
          <p className="text-sm text-neutral-500">Nobody is clocked in.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {data.onShiftNow.map((s) => (
              <li
                key={s.employeeName + s.since}
                className="flex items-center gap-2 rounded-full bg-green-50 py-1 pr-3 pl-1 text-sm text-green-800"
              >
                <PhotoThumb
                  url={s.photoUrl}
                  size="sm"
                  onOpen={() =>
                    s.photoUrl &&
                    setViewPhoto({
                      url: s.photoUrl,
                      caption: `${s.employeeName} · clocked in ${formatManilaTime(s.since)}`,
                    })
                  }
                />
                {s.employeeName} · since {formatManilaTime(s.since)}
                {s.longOpen && (
                  <span className="ml-1 font-semibold text-red-600">
                    (over 14 hrs)
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {edit && (
        <EditForm
          edit={edit}
          setEdit={setEdit}
          employees={edit.id ? data.employees : activeEmployees}
        />
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <DateRangePicker
          preset={search.range}
          from={data.range.from}
          to={data.range.to}
          onChange={(range, custom) =>
            navigate({
              search: (prev) => ({
                ...prev,
                range,
                from: custom?.from,
                to: custom?.to,
              }),
            })
          }
        />
        <select
          className={`${inputClassName} w-full sm:w-auto`}
          value={search.staff ?? ''}
          onChange={(e) =>
            navigate({
              search: (prev) => ({
                ...prev,
                staff: e.target.value || undefined,
              }),
            })
          }
        >
          <option value="">All staff</option>
          {data.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name}
              {e.is_active ? '' : ' (inactive)'}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={search.flagged}
            onChange={(e) =>
              navigate({
                search: (prev) => ({ ...prev, flagged: e.target.checked }),
              })
            }
          />
          Flagged only
        </label>
      </div>

      {/* Phones: one card per shift, tap to edit. */}
      <div className="flex flex-col gap-2 md:hidden">
        {data.rows.length === 0 && (
          <Card className="p-4 text-sm text-neutral-500">
            No shifts in this range.
          </Card>
        )}
        {data.rows.map((r) => (
          <div
            key={r.id}
            className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm"
          >
            <PhotoThumb
              url={r.photoUrl}
              manual={r.source === 'manual' && !r.photoUrl}
              onOpen={() =>
                r.photoUrl &&
                setViewPhoto({
                  url: r.photoUrl,
                  caption: `${r.employeeName} · ${formatManilaDate(r.work_date)} ${formatManilaTime(r.clock_in_at)}`,
                })
              }
            />
            <button
              type="button"
              disabled={r.locked}
              onClick={() => startEdit(r, r.clock_out_at === null)}
              className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left"
            >
              <div className="min-w-0">
                <p className="font-medium text-neutral-900">{r.employeeName}</p>
                <p className="text-sm text-neutral-500">
                  {formatManilaDate(r.work_date)} ·{' '}
                  {formatManilaTime(r.clock_in_at)} –{' '}
                  {r.clock_out_at ? formatManilaTime(r.clock_out_at) : 'now'}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {r.lateMinutes > 0 && (
                    <Badge tone="warning">Late {r.lateMinutes}m</Badge>
                  )}
                  {r.longOpen && <Badge tone="critical">Open 14h+</Badge>}
                  {r.flagged && !r.longOpen && (
                    <Badge tone="warning">Flagged</Badge>
                  )}
                  {r.source === 'manual' && (
                    <Badge tone="neutral">Manual</Badge>
                  )}
                  {r.locked && <Badge tone="info">Locked</Badge>}
                </div>
                {r.note && (
                  <p className="mt-1 truncate text-xs text-neutral-500">
                    {r.note}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold text-neutral-900">
                  {r.workedMinutes === null
                    ? 'On shift'
                    : formatMinutes(r.workedMinutes)}
                </p>
                {!r.locked && (
                  <p className="mt-1 text-xs text-neutral-500 underline">
                    {r.clock_out_at ? 'Edit' : 'Close shift'}
                  </p>
                )}
              </div>
            </button>
          </div>
        ))}
      </div>

      <div
        className={`${tableWrapperClassName} hidden overflow-x-auto md:block`}
      >
        <table className="w-full">
          <thead>
            <tr>
              {[
                '',
                'Staff',
                'Date',
                'In',
                'Out',
                'Hours',
                'Late',
                'Flags',
                '',
              ].map((h) => (
                <th key={h} className={tableHeadClassName}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className={`${tableCellClassName} text-neutral-500`}
                >
                  No shifts in this range.
                </td>
              </tr>
            )}
            {data.rows.map((r) => (
              <tr key={r.id} className={tableRowClassName}>
                <td className={`${tableCellClassName} w-14`}>
                  <PhotoThumb
                    url={r.photoUrl}
                    manual={r.source === 'manual' && !r.photoUrl}
                    onOpen={() =>
                      r.photoUrl &&
                      setViewPhoto({
                        url: r.photoUrl,
                        caption: `${r.employeeName} · ${formatManilaDate(r.work_date)} ${formatManilaTime(r.clock_in_at)}`,
                      })
                    }
                  />
                </td>
                <td className={tableCellClassName}>{r.employeeName}</td>
                <td className={`${tableCellClassName} whitespace-nowrap`}>
                  {formatManilaDate(r.work_date)}
                </td>
                <td className={tableCellClassName}>
                  {formatManilaTime(r.clock_in_at)}
                </td>
                <td className={tableCellClassName}>
                  {r.clock_out_at ? formatManilaTime(r.clock_out_at) : '—'}
                </td>
                <td className={tableCellClassName}>
                  {r.workedMinutes === null
                    ? 'On shift'
                    : formatMinutes(r.workedMinutes)}
                </td>
                <td className={tableCellClassName}>
                  {r.lateMinutes > 0 ? `${r.lateMinutes}m` : ''}
                </td>
                <td className={tableCellClassName}>
                  <div className="flex flex-wrap gap-1">
                    {r.longOpen && <Badge tone="critical">Open 14h+</Badge>}
                    {r.flagged && !r.longOpen && (
                      <Badge tone="warning">Flagged</Badge>
                    )}
                    {r.source === 'manual' && (
                      <Badge tone="neutral">Manual</Badge>
                    )}
                    {r.locked && <Badge tone="info">Locked</Badge>}
                  </div>
                  {r.note && (
                    <p
                      className="mt-1 max-w-[220px] truncate text-xs text-neutral-500"
                      title={r.note}
                    >
                      {r.note}
                    </p>
                  )}
                </td>
                <td className={`${tableCellClassName} whitespace-nowrap`}>
                  {!r.locked && (
                    <button
                      type="button"
                      className="text-sm font-medium text-neutral-700 underline"
                      onClick={() => startEdit(r, r.clock_out_at === null)}
                    >
                      {r.clock_out_at ? 'Edit' : 'Close shift'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Clock-in selfie thumbnail; tap to see it full size. */
function PhotoThumb({
  url,
  manual = false,
  size = 'md',
  onOpen,
}: {
  url: string | null
  manual?: boolean
  size?: 'sm' | 'md'
  onOpen: () => void
}) {
  const box = size === 'sm' ? 'size-7' : 'size-12'
  if (!url) {
    return (
      <div
        className={`${box} flex shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[10px] text-neutral-400`}
        title={manual ? 'Added by owner' : 'No photo'}
      >
        {manual ? 'Manual' : size === 'sm' ? '' : 'No photo'}
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="View clock-in photo"
      className={`${box} shrink-0 overflow-hidden rounded-full ring-2 ring-white`}
    >
      <img src={url} alt="" className="h-full w-full object-cover" />
    </button>
  )
}

function EditForm({
  edit,
  setEdit,
  employees,
}: {
  edit: EditState
  setEdit: (e: EditState | null) => void
  employees: Array<{ id: string; full_name: string }>
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<EditState>) => setEdit({ ...edit, ...patch })

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await saveAttendanceEntry({
        data: {
          id: edit.id,
          employeeId: edit.employeeId,
          clockIn: edit.clockIn,
          clockOut: edit.clockOut || null,
          breakMinutes:
            edit.breakMinutes === '' ? null : Number(edit.breakMinutes),
          note: edit.note,
        },
      })
      setEdit(null)
      await router.invalidate()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!edit.id) return
    if (!edit.note.trim()) {
      setError('Add a note saying why this shift is being deleted')
      return
    }
    if (!window.confirm('Delete this shift?')) return
    setBusy(true)
    setError(null)
    try {
      await deleteAttendanceEntry({ data: { id: edit.id, note: edit.note } })
      setEdit(null)
      await router.invalidate()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* Phones: dimmed backdrop behind the bottom sheet. */}
      <div
        className="fixed inset-0 z-40 bg-black/40 md:hidden"
        onClick={() => setEdit(null)}
      />
      <div className="fixed inset-x-0 bottom-0 z-50 max-h-[90vh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl md:static md:z-auto md:mb-6 md:max-h-none md:overflow-visible md:rounded-xl md:border md:border-neutral-200 md:pb-4 md:shadow-sm">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 md:hidden" />
        <h2 className="mb-3 text-base font-semibold text-neutral-900 md:text-sm">
          {edit.id ? 'Edit shift' : 'Add shift'}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className={labelClassName}>
            Staff
            <select
              className={inputClassName}
              value={edit.employeeId}
              disabled={!!edit.id}
              onChange={(e) => set({ employeeId: e.target.value })}
            >
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClassName}>
            Clock in
            <input
              type="datetime-local"
              className={inputClassName}
              value={edit.clockIn}
              onChange={(e) => set({ clockIn: e.target.value })}
            />
          </label>
          <label className={labelClassName}>
            Clock out
            <input
              type="datetime-local"
              className={inputClassName}
              value={edit.clockOut}
              onChange={(e) => set({ clockOut: e.target.value })}
            />
          </label>
          <label className={labelClassName}>
            Break (min)
            <input
              type="number"
              min={0}
              placeholder="Default"
              className={inputClassName}
              value={edit.breakMinutes}
              onChange={(e) => set({ breakMinutes: e.target.value })}
            />
          </label>
          <label className={labelClassName}>
            Note (required)
            <input
              className={inputClassName}
              value={edit.note}
              placeholder="e.g. Forgot to clock out"
              onChange={(e) => set({ note: e.target.value })}
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Times are Manila time. Leave Break empty to use the usual rule (unpaid
          break taken only on shifts over 5 hrs).
        </p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row [&>button]:w-full sm:[&>button]:w-fit [&>button]:py-3 sm:[&>button]:py-2">
          <button
            type="button"
            className={buttonPrimaryClassName}
            disabled={busy || !edit.employeeId || !edit.note.trim()}
            onClick={save}
          >
            Save
          </button>
          <button
            type="button"
            className={buttonSecondaryClassName}
            onClick={() => setEdit(null)}
          >
            Cancel
          </button>
          {edit.id && (
            <button
              type="button"
              className={buttonDangerClassName}
              disabled={busy}
              onClick={remove}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </>
  )
}

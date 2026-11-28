import { Fragment, useState } from 'react'
import { z } from 'zod'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import {
  computePayroll,
  deleteDayMark,
  finalizePayroll,
  getPayroll,
  markPayrollPaid,
  saveDayMark,
  updatePayrollItem,
} from '#/server/admin/payroll'
import type { PayrollPageData } from '#/server/admin/payroll'
import { getErrorMessage } from '#/lib/utils/errors'
import { formatCentsAsPHP, pesosToCents } from '#/lib/utils/money'
import { formatManilaDate, formatPeriod } from '#/lib/payroll/format'
import { payrollCsv, payslipHtml } from '#/lib/payroll/export'
import {
  AttendanceTabs,
  OwnerOnlyError,
} from '#/components/admin/AttendanceTabs'
import { Badge } from '#/components/admin/Badge'
import { Card } from '#/components/admin/Card'
import { PageHeader } from '#/components/admin/PageHeader'
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

export const Route = createFileRoute('/admin/attendance/payroll')({
  validateSearch: z.object({
    period: z.string().uuid().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getPayroll({ data: { periodId: deps.period } }),
  component: PayrollPage,
  errorComponent: OwnerOnlyError,
})

type Item = PayrollPageData['items'][number]

const STATUS_TONE = {
  draft: 'warning',
  finalized: 'info',
  paid: 'success',
} as const
const STATUS_LABEL = {
  draft: 'Draft',
  finalized: 'Finalized (locked)',
  paid: 'Paid',
}

function money(cents: number) {
  return formatCentsAsPHP(cents)
}

function PayrollPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate({ from: Route.fullPath })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const { period } = data
  const isDraft = period.status === 'draft'

  async function run(fn: () => Promise<unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    setError(null)
    try {
      await fn()
      await router.invalidate()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function downloadCsv() {
    const blob = new Blob([payrollCsv(data.items)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `spades-payroll-${period.start_date}-to-${period.end_date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function openPayslip(item: Item) {
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(payslipHtml(item, period))
    w.document.close()
  }

  const totalNet = data.items.reduce((s, i) => s + i.net_pay_cents, 0)

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader title="Attendance & Payroll" />
      <AttendanceTabs active="payroll" isOwner />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          className={inputClassName}
          value={period.id}
          onChange={(e) => navigate({ search: { period: e.target.value } })}
        >
          {data.periods.map((p) => (
            <option key={p.id} value={p.id}>
              {formatPeriod(p.start_date, p.end_date)} ·{' '}
              {STATUS_LABEL[p.status]}
            </option>
          ))}
        </select>
        <Badge tone={STATUS_TONE[period.status]}>
          {STATUS_LABEL[period.status]}
        </Badge>
        <div className="ml-auto flex flex-wrap gap-2">
          {isDraft && (
            <button
              type="button"
              className={buttonSecondaryClassName}
              disabled={busy}
              onClick={() =>
                run(() => computePayroll({ data: { periodId: period.id } }))
              }
            >
              {period.computed_at ? 'Re-compute' : 'Compute'}
            </button>
          )}
          {isDraft && (
            <button
              type="button"
              className={buttonPrimaryClassName}
              disabled={busy || !period.computed_at || data.stale}
              onClick={() =>
                run(
                  () => finalizePayroll({ data: { periodId: period.id } }),
                  'Finalize this payroll? It will be locked — hours and pay for these dates can’t be changed after.',
                )
              }
            >
              Finalize
            </button>
          )}
          {period.status === 'finalized' && (
            <button
              type="button"
              className={buttonPrimaryClassName}
              disabled={busy}
              onClick={() =>
                run(
                  () => markPayrollPaid({ data: { periodId: period.id } }),
                  'Mark this payroll as paid?',
                )
              }
            >
              Mark as paid
            </button>
          )}
          {data.items.length > 0 && (
            <button
              type="button"
              className={buttonSecondaryClassName}
              onClick={downloadCsv}
            >
              Download CSV
            </button>
          )}
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {isDraft && data.stale && (
        <p className="mb-4 rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          Hours changed since the last Compute — press Re-compute before
          finalizing.
        </p>
      )}

      {data.warnings.length > 0 && (
        <Card className="mb-4 border-yellow-200 bg-yellow-50 p-4">
          <p className="mb-1 text-sm font-semibold text-yellow-900">
            Check these first
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-yellow-900">
            {data.warnings.map((w, i) => (
              <li key={i}>
                <strong>{w.employeeName}:</strong> {w.message}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.items.length === 0 ? (
        <Card className="p-6 text-sm text-neutral-600">
          {isDraft
            ? 'Nothing computed yet. Press Compute to build this period’s payroll from attendance.'
            : 'No payroll items in this period.'}
        </Card>
      ) : (
        <div className={`${tableWrapperClassName} overflow-x-auto`}>
          <table className="w-full">
            <thead>
              <tr>
                {[
                  'Staff',
                  'Days',
                  'Hours',
                  'OT',
                  'Late',
                  'Absent',
                  'Base',
                  'Deductions',
                  'Adjustments',
                  'Net',
                  '',
                ].map((h) => (
                  <th
                    key={h}
                    className={`${tableHeadClassName} whitespace-nowrap`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => {
                const deductions =
                  i.late_deduction_cents +
                  i.undertime_deduction_cents +
                  i.absence_deduction_cents
                const adj = i.adjustments.reduce(
                  (s, a) => s + a.amount_cents,
                  0,
                )
                return (
                  <Fragment key={i.id}>
                    <tr className={tableRowClassName}>
                      <td className={tableCellClassName}>
                        <p className="font-medium">{i.employeeName}</p>
                        <p className="text-xs text-neutral-500">
                          {i.pay_type === 'hourly' ? 'Hourly' : 'Monthly'}
                        </p>
                      </td>
                      <td className={tableCellClassName}>{i.days_worked}</td>
                      <td className={tableCellClassName}>
                        {Number(i.regular_hours)}
                      </td>
                      <td className={tableCellClassName}>
                        {Number(i.overtime_hours) || ''}
                        {i.overtime_pay_cents > 0 && (
                          <p className="text-xs text-neutral-500">
                            {money(i.overtime_pay_cents)}
                          </p>
                        )}
                      </td>
                      <td className={tableCellClassName}>
                        {i.late_minutes + i.undertime_minutes > 0
                          ? `${i.late_minutes + i.undertime_minutes}m`
                          : ''}
                      </td>
                      <td className={tableCellClassName}>
                        {i.absent_days || ''}
                      </td>
                      <td className={`${tableCellClassName} whitespace-nowrap`}>
                        {money(i.base_pay_cents)}
                      </td>
                      <td
                        className={`${tableCellClassName} whitespace-nowrap text-red-600`}
                      >
                        {deductions > 0 ? `−${money(deductions)}` : ''}
                      </td>
                      <td className={`${tableCellClassName} whitespace-nowrap`}>
                        {adj !== 0 &&
                          (adj > 0 ? '+' : '−') + money(Math.abs(adj))}
                      </td>
                      <td
                        className={`${tableCellClassName} whitespace-nowrap font-semibold`}
                      >
                        {money(i.net_pay_cents)}
                      </td>
                      <td className={`${tableCellClassName} whitespace-nowrap`}>
                        <div className="flex gap-3">
                          {isDraft && (
                            <button
                              type="button"
                              className="text-sm text-neutral-700 underline"
                              onClick={() =>
                                setEditing(editing === i.id ? null : i.id)
                              }
                            >
                              Adjust
                            </button>
                          )}
                          <button
                            type="button"
                            className="text-sm text-neutral-700 underline"
                            onClick={() => openPayslip(i)}
                          >
                            Payslip
                          </button>
                        </div>
                      </td>
                    </tr>
                    {editing === i.id && (
                      <tr>
                        <td colSpan={11} className="bg-neutral-50 px-4 py-3">
                          <AdjustmentsEditor
                            item={i}
                            onDone={() => setEditing(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              <tr className="border-t border-neutral-200 bg-neutral-50">
                <td
                  colSpan={9}
                  className={`${tableCellClassName} text-right font-semibold`}
                >
                  Total net
                </td>
                <td
                  className={`${tableCellClassName} whitespace-nowrap font-semibold`}
                >
                  {money(totalNet)}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <DayMarks data={data} />
    </div>
  )
}

function AdjustmentsEditor({
  item,
  onDone,
}: {
  item: Item
  onDone: () => void
}) {
  const router = useRouter()
  const [rows, setRows] = useState(
    item.adjustments.map((a) => ({
      label: a.label,
      amount: String(a.amount_cents / 100),
    })),
  )
  const [notes, setNotes] = useState(item.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await updatePayrollItem({
        data: {
          itemId: item.id,
          adjustments: rows
            .filter(
              (r) =>
                r.label.trim() && r.amount !== '' && Number(r.amount) !== 0,
            )
            .map((r) => ({
              label: r.label.trim(),
              amount_cents: pesosToCents(Number(r.amount)),
            })),
          notes: notes.trim() || null,
        },
      })
      await router.invalidate()
      onDone()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const presets = [
    'Bonus',
    'Holiday pay',
    'Cash advance',
    'SSS',
    'PhilHealth',
    'Pag-IBIG',
    'Tax',
  ]

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-neutral-500">
        Use a plus amount for extra pay (bonus, holiday pay) and a minus amount
        for deductions (cash advance, SSS, PhilHealth, Pag-IBIG, tax).
      </p>
      {rows.map((r, idx) => (
        <div key={idx} className="flex flex-wrap gap-2">
          <input
            list="adjustment-labels"
            className={inputClassName}
            placeholder="Label"
            value={r.label}
            onChange={(e) =>
              setRows(
                rows.map((x, j) =>
                  j === idx ? { ...x, label: e.target.value } : x,
                ),
              )
            }
          />
          <input
            type="number"
            step="0.01"
            className={`${inputClassName} w-36`}
            placeholder="₱ (− to deduct)"
            value={r.amount}
            onChange={(e) =>
              setRows(
                rows.map((x, j) =>
                  j === idx ? { ...x, amount: e.target.value } : x,
                ),
              )
            }
          />
          <button
            type="button"
            className="text-sm text-red-600"
            onClick={() => setRows(rows.filter((_, j) => j !== idx))}
          >
            Remove
          </button>
        </div>
      ))}
      <datalist id="adjustment-labels">
        {presets.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <button
        type="button"
        className="w-fit text-sm text-neutral-700 underline"
        onClick={() => setRows([...rows, { label: '', amount: '' }])}
      >
        + Add line
      </button>
      <label className={labelClassName}>
        Notes
        <input
          className={inputClassName}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className={buttonPrimaryClassName}
          disabled={busy}
          onClick={save}
        >
          Save
        </button>
        <button
          type="button"
          className={buttonSecondaryClassName}
          onClick={onDone}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function DayMarks({ data }: { data: PayrollPageData }) {
  const router = useRouter()
  const [date, setDate] = useState(data.period.start_date)
  const [kind, setKind] = useState<'holiday' | 'leave'>('holiday')
  const [employeeId, setEmployeeId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const isDraft = data.period.status === 'draft'

  async function add() {
    setBusy(true)
    setError(null)
    try {
      await saveDayMark({
        data: {
          markDate: date,
          kind,
          employeeId: kind === 'leave' ? employeeId || null : null,
          note: note.trim() || null,
        },
      })
      setNote('')
      await router.invalidate()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    try {
      await deleteDayMark({ data: { id } })
      await router.invalidate()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  return (
    <Card className="mt-8 p-4">
      <h2 className="text-sm font-semibold text-neutral-900">
        Holidays & leave this period
      </h2>
      <p className="mt-1 text-xs text-neutral-500">
        Monthly staff aren’t marked absent on these days. Press Re-compute after
        changes.
      </p>
      {data.dayMarks.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {data.dayMarks.map((m) => (
            <li key={m.id} className="flex items-center gap-2">
              <span>{formatManilaDate(m.mark_date)}</span>
              <Badge tone={m.kind === 'holiday' ? 'info' : 'neutral'}>
                {m.kind === 'holiday' ? 'Holiday' : 'Leave'}
              </Badge>
              <span className="text-neutral-600">
                {m.employeeName ?? 'Everyone'}
                {m.note ? ` · ${m.note}` : ''}
              </span>
              {isDraft && (
                <button
                  type="button"
                  className="text-xs text-red-600"
                  onClick={() => remove(m.id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isDraft && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className={labelClassName}>
            Date
            <input
              type="date"
              min={data.period.start_date}
              max={data.period.end_date}
              className={inputClassName}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className={labelClassName}>
            Type
            <select
              className={inputClassName}
              value={kind}
              onChange={(e) => setKind(e.target.value as 'holiday' | 'leave')}
            >
              <option value="holiday">Holiday (everyone)</option>
              <option value="leave">Leave (one person)</option>
            </select>
          </label>
          {kind === 'leave' && (
            <label className={labelClassName}>
              Staff
              <select
                className={inputClassName}
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
              >
                <option value="">Choose…</option>
                {data.employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={labelClassName}>
            Note
            <input
              className={inputClassName}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            type="button"
            className={buttonSecondaryClassName}
            disabled={busy || (kind === 'leave' && !employeeId)}
            onClick={add}
          >
            Add
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Card>
  )
}

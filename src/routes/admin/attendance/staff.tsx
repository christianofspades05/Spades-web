import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  getPayrollStaff,
  saveEmployee,
  savePayProfile,
} from '#/server/admin/payroll'
import type { PayrollStaff } from '#/server/admin/payroll'
import type { PayProfileRow } from '#/server/admin/attendance'
import { getErrorMessage } from '#/lib/utils/errors'
import { formatCentsAsPHP, pesosToCents } from '#/lib/utils/money'
import { daysAgo } from '#/lib/utils/date-range'
import { WEEKDAYS, formatManilaDate } from '#/lib/payroll/format'
import { periodForDate } from '#/lib/payroll/compute'
import {
  ATTENDANCE_PAGE_CLASS,
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
} from '#/components/admin/ui'

export const Route = createFileRoute('/admin/attendance/staff')({
  loader: () => getPayrollStaff(),
  component: PayRatesPage,
  errorComponent: OwnerOnlyError,
})

type Employee = PayrollStaff['employees'][number]

function rateLabel(p: PayProfileRow | null): string {
  if (!p) return 'No rate set'
  return p.pay_type === 'hourly'
    ? `${formatCentsAsPHP(p.hourly_rate_cents ?? 0)} / hour`
    : `${formatCentsAsPHP(p.monthly_salary_cents ?? 0)} / month`
}

function PayRatesPage() {
  const data = Route.useLoaderData()
  const [adding, setAdding] = useState(false)

  return (
    <div className={ATTENDANCE_PAGE_CLASS}>
      <div className="mb-4 flex items-center justify-between md:hidden">
        <h1 className="text-lg font-semibold text-neutral-900">Pay rates</h1>
        {!adding && (
          <button
            type="button"
            className={buttonPrimaryClassName}
            onClick={() => setAdding(true)}
          >
            Add staff
          </button>
        )}
      </div>
      <div className="hidden md:block">
        <PageHeader
          title="Attendance & Payroll"
          action={
            !adding && (
              <button
                type="button"
                className={buttonPrimaryClassName}
                onClick={() => setAdding(true)}
              >
                Add staff
              </button>
            )
          }
        />
      </div>
      <AttendanceTabs active="staff" isOwner />

      {adding && (
        <EmployeeForm logins={data.logins} onDone={() => setAdding(false)} />
      )}

      {data.employees.length === 0 && !adding && (
        <Card className="p-6 text-sm text-neutral-600">
          No staff added yet. Press “Add staff” to add each person you pay, then
          set their rate and schedule.
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {data.employees.map((e) => (
          <EmployeeCard key={e.id} employee={e} logins={data.logins} />
        ))}
      </div>
    </div>
  )
}

function EmployeeForm({
  employee,
  logins,
  onDone,
}: {
  employee?: Employee
  logins: PayrollStaff['logins']
  onDone: () => void
}) {
  const router = useRouter()
  const [fullName, setFullName] = useState(employee?.full_name ?? '')
  const [staffUserId, setStaffUserId] = useState(employee?.staff_user_id ?? '')
  const [isActive, setIsActive] = useState(employee?.is_active ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await saveEmployee({
        data: {
          id: employee?.id,
          fullName,
          staffUserId: staffUserId || null,
          isActive,
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

  return (
    <Card className="mb-4 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClassName}>
          Name
          <input
            className={inputClassName}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </label>
        <label className={labelClassName}>
          Admin login (for clocking in)
          <select
            className={inputClassName}
            value={staffUserId}
            onChange={(e) => setStaffUserId(e.target.value)}
          >
            <option value="">No login — I’ll log their time</option>
            {logins
              .filter((l) => !l.linked || l.id === employee?.staff_user_id)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.full_name}
                </option>
              ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Active (can clock in)
        </label>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className={buttonPrimaryClassName}
          disabled={busy || !fullName.trim()}
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
    </Card>
  )
}

function EmployeeCard({
  employee,
  logins,
}: {
  employee: Employee
  logins: PayrollStaff['logins']
}) {
  const [mode, setMode] = useState<'view' | 'details' | 'rate'>('view')
  const p = employee.current

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-neutral-900">
            {employee.full_name}{' '}
            {!employee.is_active && <Badge tone="neutral">Inactive</Badge>}
          </p>
          <p className="text-sm text-neutral-500">
            {employee.loginName ? `Login: ${employee.loginName}` : 'No login'} ·{' '}
            {rateLabel(p)}
          </p>
          {p && (
            <p className="mt-1 text-xs text-neutral-500">
              {p.scheduled_start
                ? `Starts ${p.scheduled_start.slice(0, 5)}`
                : 'No start time'}{' '}
              · {p.scheduled_hours_per_day} hrs/day · {p.work_days_per_week}-day
              week · Rest:{' '}
              {p.rest_days.length
                ? p.rest_days.map((d) => WEEKDAYS[d]).join(', ')
                : 'none'}{' '}
              · OT{' '}
              {p.overtime_enabled
                ? `paid ×${p.overtime_multiplier}`
                : 'not paid'}
              {p.pay_type === 'monthly' &&
                ` · Lates ${p.deduct_lates ? 'deducted' : 'not deducted'}`}{' '}
              · since {formatManilaDate(p.effective_from)}
            </p>
          )}
        </div>
        {mode === 'view' && (
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonSecondaryClassName}
              onClick={() => setMode('details')}
            >
              Edit details
            </button>
            <button
              type="button"
              className={buttonPrimaryClassName}
              onClick={() => setMode('rate')}
            >
              {p ? 'Change rate' : 'Set rate'}
            </button>
          </div>
        )}
      </div>

      {mode === 'details' && (
        <div className="mt-4">
          <EmployeeForm
            employee={employee}
            logins={logins}
            onDone={() => setMode('view')}
          />
        </div>
      )}
      {mode === 'rate' && (
        <ProfileForm employee={employee} onDone={() => setMode('view')} />
      )}

      {employee.history.length > 1 && (
        <details className="mt-3 text-xs text-neutral-500">
          <summary className="cursor-pointer">Rate history</summary>
          <ul className="mt-1 space-y-0.5">
            {employee.history.map((h) => (
              <li key={h.id}>
                {formatManilaDate(h.effective_from)} –{' '}
                {h.effective_to ? formatManilaDate(h.effective_to) : 'now'}:{' '}
                {rateLabel(h)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  )
}

function ProfileForm({
  employee,
  onDone,
}: {
  employee: Employee
  onDone: () => void
}) {
  const router = useRouter()
  const p = employee.current
  const [payType, setPayType] = useState<'hourly' | 'monthly'>(
    p?.pay_type ?? 'monthly',
  )
  const [amount, setAmount] = useState(() => {
    if (!p) return ''
    const cents =
      p.pay_type === 'hourly' ? p.hourly_rate_cents : p.monthly_salary_cents
    return cents === null ? '' : String(cents / 100)
  })
  const [workDays, setWorkDays] = useState<5 | 6>(
    p?.work_days_per_week === 5 ? 5 : 6,
  )
  const [restDays, setRestDays] = useState<number[]>(p?.rest_days ?? [0])
  const [start, setStart] = useState(p?.scheduled_start?.slice(0, 5) ?? '09:00')
  const [hours, setHours] = useState(String(p?.scheduled_hours_per_day ?? 8))
  const [breakMin, setBreakMin] = useState(
    String(p?.unpaid_break_minutes ?? 60),
  )
  const [grace, setGrace] = useState(String(p?.late_grace_minutes ?? 10))
  const [deductLates, setDeductLates] = useState(p?.deduct_lates ?? true)
  const [otEnabled, setOtEnabled] = useState(p?.overtime_enabled ?? false)
  const [otMult, setOtMult] = useState(String(p?.overtime_multiplier ?? 1.25))
  const [effectiveFrom, setEffectiveFrom] = useState(() =>
    // A first rate starts with the current pay period so it gets paid.
    p ? daysAgo(0) : periodForDate(daysAgo(0)).start,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleRest(d: number) {
    setRestDays((cur) =>
      cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort(),
    )
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const cents = pesosToCents(Number(amount))
      await savePayProfile({
        data: {
          employeeId: employee.id,
          payType,
          hourlyRateCents: payType === 'hourly' ? cents : null,
          monthlySalaryCents: payType === 'monthly' ? cents : null,
          workDaysPerWeek: workDays,
          restDays,
          scheduledStart: start || null,
          scheduledHoursPerDay: Number(hours),
          unpaidBreakMinutes: Number(breakMin),
          lateGraceMinutes: Number(grace),
          deductLates,
          overtimeEnabled: otEnabled,
          overtimeMultiplier: Number(otMult),
          effectiveFrom,
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

  return (
    <div className="mt-4 border-t border-neutral-100 pt-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={labelClassName}>
          Pay type
          <select
            className={inputClassName}
            value={payType}
            onChange={(e) => setPayType(e.target.value as 'hourly' | 'monthly')}
          >
            <option value="monthly">Monthly salary</option>
            <option value="hourly">Hourly</option>
          </select>
        </label>
        <label className={labelClassName}>
          {payType === 'hourly' ? 'Rate per hour (₱)' : 'Monthly salary (₱)'}
          <input
            type="number"
            min={0}
            step="0.01"
            className={inputClassName}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className={labelClassName}>
          Start time
          <input
            type="time"
            className={inputClassName}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className={labelClassName}>
          Hours per day
          <input
            type="number"
            min={1}
            max={16}
            step="0.5"
            className={inputClassName}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
        </label>
        <label className={labelClassName}>
          Work week
          <select
            className={inputClassName}
            value={workDays}
            onChange={(e) => setWorkDays(Number(e.target.value) as 5 | 6)}
          >
            <option value={6}>6 days</option>
            <option value={5}>5 days</option>
          </select>
        </label>
        <label className={labelClassName}>
          Unpaid break (min)
          <input
            type="number"
            min={0}
            className={inputClassName}
            value={breakMin}
            onChange={(e) => setBreakMin(e.target.value)}
          />
        </label>
        <label className={labelClassName}>
          Late grace (min)
          <input
            type="number"
            min={0}
            className={inputClassName}
            value={grace}
            onChange={(e) => setGrace(e.target.value)}
          />
        </label>
        <label className={labelClassName}>
          Starts on
          <input
            type="date"
            className={inputClassName}
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-3">
        <p className="text-sm font-medium text-neutral-700">Rest days</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {WEEKDAYS.map((d, i) => (
            <button
              key={d}
              type="button"
              onClick={() => toggleRest(i)}
              className={`rounded-md border px-2.5 py-1 text-sm ${
                restDays.includes(i)
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-300 bg-white text-neutral-700'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-sm text-neutral-700">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={otEnabled}
            onChange={(e) => setOtEnabled(e.target.checked)}
          />
          Pay overtime
        </label>
        {otEnabled && (
          <label className="flex items-center gap-2">
            OT rate ×
            <input
              type="number"
              min={1}
              step="0.05"
              className={`${inputClassName} w-20`}
              value={otMult}
              onChange={(e) => setOtMult(e.target.value)}
            />
          </label>
        )}
        {payType === 'monthly' && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={deductLates}
              onChange={(e) => setDeductLates(e.target.checked)}
            />
            Deduct lates and undertime
          </label>
        )}
      </div>

      <p className="mt-2 text-xs text-neutral-500">
        A change starts on the “Starts on” date — earlier pay periods keep the
        old rate.
      </p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className={buttonPrimaryClassName}
          disabled={busy || amount === ''}
          onClick={save}
        >
          Save rate
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

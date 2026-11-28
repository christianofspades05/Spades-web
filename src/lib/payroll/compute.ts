/**
 * Pure pay math for Staff Attendance & Payroll. No I/O — the server
 * function (src/server/admin/payroll.ts) loads rows and hands them here, so
 * the same inputs always give the same payroll (re-running Compute is
 * idempotent) and every rule is unit-tested (compute.test.ts).
 *
 * All calendar logic is Asia/Manila (fixed UTC+8, no DST). Money is integer
 * centavos; intermediate values stay fractional and are rounded once per
 * line item.
 */

const MANILA_OFFSET_MS = 8 * 60 * 60_000

/** Shifts open longer than this are flagged and left out of pay. */
export const MAX_SHIFT_HOURS = 14
/** Default rounding step for worked time per shift. */
export const DEFAULT_ROUND_MINUTES = 15
/** The unpaid break only applies to shifts longer than this. */
export const BREAK_THRESHOLD_MINUTES = 5 * 60

export type PayType = 'hourly' | 'monthly'

export interface PayProfile {
  pay_type: PayType
  hourly_rate_cents: number | null
  monthly_salary_cents: number | null
  work_days_per_week: number
  /** 0 = Sunday .. 6 = Saturday. */
  rest_days: number[]
  /** "HH:MM" or "HH:MM:SS", Manila time. */
  scheduled_start: string | null
  scheduled_hours_per_day: number
  unpaid_break_minutes: number
  late_grace_minutes: number
  deduct_lates: boolean
  overtime_enabled: boolean
  overtime_multiplier: number
  effective_from: string
  effective_to: string | null
}

export interface Shift {
  id: string
  clock_in_at: string
  clock_out_at: string | null
  break_minutes: number | null
  flagged?: boolean
}

export interface Adjustment {
  label: string
  amount_cents: number
}

export interface DayMark {
  /** null = applies to everyone (store holiday). */
  employee_id: string | null
  mark_date: string
  kind: 'holiday' | 'leave'
}

export interface PayrollWarning {
  kind: 'open_shift' | 'long_shift' | 'flagged' | 'no_profile'
  shiftId?: string
  message: string
}

export interface PayrollItemResult {
  pay_type: PayType
  rate_snapshot_cents: number
  days_worked: number
  regular_hours: number
  overtime_hours: number
  late_minutes: number
  undertime_minutes: number
  absent_days: number
  base_pay_cents: number
  overtime_pay_cents: number
  late_deduction_cents: number
  undertime_deduction_cents: number
  absence_deduction_cents: number
  gross_pay_cents: number
  net_pay_cents: number
}

// ---------------------------------------------------------------------------
// Manila date helpers
// ---------------------------------------------------------------------------

/** Manila calendar date (YYYY-MM-DD) an instant falls on. */
export function manilaDate(iso: string): string {
  return new Date(new Date(iso).getTime() + MANILA_OFFSET_MS)
    .toISOString()
    .slice(0, 10)
}

/** Minutes since Manila midnight for an instant. */
export function manilaMinuteOfDay(iso: string): number {
  const d = new Date(new Date(iso).getTime() + MANILA_OFFSET_MS)
  return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60
}

/** Day of week (0 = Sunday) of a YYYY-MM-DD date. */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function datesBetween(start: string, end: string): string[] {
  const out: string[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d)
  return out
}

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate()
}

/** The semi-monthly period (1–15 or 16–end of month) containing `date`. */
export function periodForDate(date: string): { start: string; end: string } {
  const [y, m, d] = date.split('-').map(Number)
  const mm = String(m).padStart(2, '0')
  if (d <= 15) return { start: `${y}-${mm}-01`, end: `${y}-${mm}-15` }
  return {
    start: `${y}-${mm}-16`,
    end: `${y}-${mm}-${String(lastDayOfMonth(y, m)).padStart(2, '0')}`,
  }
}

export function nextPeriod(period: { end: string }): {
  start: string
  end: string
} {
  return periodForDate(addDays(period.end, 1))
}

function parseTimeToMinutes(t: string): number {
  const [h, m, s] = t.split(':').map(Number)
  return h * 60 + (m || 0) + (s || 0) / 60
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

/** 313 working days/yr for a 6-day week, 261 for a 5-day week. */
export function annualFactor(workDaysPerWeek: number): number {
  return workDaysPerWeek === 5 ? 261 : 313
}

/** Monthly staff daily rate in (fractional) centavos: salary × 12 / factor. */
export function dailyRateCents(profile: PayProfile): number {
  return (
    ((profile.monthly_salary_cents ?? 0) * 12) /
    annualFactor(profile.work_days_per_week)
  )
}

/** Monthly staff per-minute rate in (fractional) centavos. */
export function perMinuteCents(profile: PayProfile): number {
  return dailyRateCents(profile) / profile.scheduled_hours_per_day / 60
}

/** The profile in effect on `date`, if any. */
export function profileOn(
  profiles: PayProfile[],
  date: string,
): PayProfile | null {
  return (
    profiles.find(
      (p) =>
        p.effective_from <= date &&
        (p.effective_to === null || p.effective_to >= date),
    ) ?? null
  )
}

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

export function shiftRawMinutes(shift: Shift): number | null {
  if (!shift.clock_out_at) return null
  return (
    (new Date(shift.clock_out_at).getTime() -
      new Date(shift.clock_in_at).getTime()) /
    60_000
  )
}

/** Worked minutes for one closed shift: (out − in) − unpaid break (only on
 *  shifts over 5 hrs, unless the owner overrode it), rounded to the nearest
 *  `roundTo` minutes. */
export function shiftWorkedMinutes(
  shift: Shift,
  profile: Pick<PayProfile, 'unpaid_break_minutes'>,
  roundTo = DEFAULT_ROUND_MINUTES,
): number {
  const raw = shiftRawMinutes(shift)
  if (raw === null) return 0
  const brk =
    shift.break_minutes ??
    (raw > BREAK_THRESHOLD_MINUTES ? profile.unpaid_break_minutes : 0)
  const worked = Math.max(0, raw - brk)
  return roundTo > 0 ? Math.round(worked / roundTo) * roundTo : worked
}

/** Minutes late for a clock-in, or 0 if within the grace period. Past the
 *  grace period the whole lateness counts (9:30 with a 9:00 start = 30). */
export function lateMinutes(
  clockInIso: string,
  profile: Pick<PayProfile, 'scheduled_start' | 'late_grace_minutes'>,
): number {
  if (!profile.scheduled_start) return 0
  const late =
    manilaMinuteOfDay(clockInIso) - parseTimeToMinutes(profile.scheduled_start)
  if (late <= profile.late_grace_minutes) return 0
  return Math.round(late)
}

// ---------------------------------------------------------------------------
// Period computation
// ---------------------------------------------------------------------------

export interface ComputeInput {
  employeeId: string
  period: { start: string; end: string }
  /** All profile versions for the employee (any order). */
  profiles: PayProfile[]
  shifts: Shift[]
  dayMarks: DayMark[]
  adjustments: Adjustment[]
  /** Manila "today" — days after it are never counted as absences. */
  today: string
  roundTo?: number
}

export interface ComputeOutput {
  item: PayrollItemResult | null
  warnings: PayrollWarning[]
}

export function totals(
  parts: Pick<
    PayrollItemResult,
    | 'base_pay_cents'
    | 'overtime_pay_cents'
    | 'late_deduction_cents'
    | 'undertime_deduction_cents'
    | 'absence_deduction_cents'
  >,
  adjustments: Adjustment[],
): { gross_pay_cents: number; net_pay_cents: number } {
  const positive = adjustments
    .filter((a) => a.amount_cents > 0)
    .reduce((s, a) => s + a.amount_cents, 0)
  const negative = adjustments
    .filter((a) => a.amount_cents < 0)
    .reduce((s, a) => s + a.amount_cents, 0)
  const gross =
    parts.base_pay_cents +
    parts.overtime_pay_cents -
    parts.late_deduction_cents -
    parts.undertime_deduction_cents -
    parts.absence_deduction_cents +
    positive
  return { gross_pay_cents: gross, net_pay_cents: gross + negative }
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function computePayrollItem(input: ComputeInput): ComputeOutput {
  const { period, profiles, dayMarks, employeeId, today } = input
  const roundTo = input.roundTo ?? DEFAULT_ROUND_MINUTES
  const warnings: PayrollWarning[] = []

  const sortedProfiles = [...profiles].sort((a, b) =>
    a.effective_from.localeCompare(b.effective_from),
  )
  const periodDates = datesBetween(period.start, period.end)
  const periodProfiles = sortedProfiles.filter(
    (p) =>
      p.effective_from <= period.end &&
      (p.effective_to === null || p.effective_to >= period.start),
  )

  // Group usable shifts by the Manila date they started on.
  const byDate = new Map<string, Shift[]>()
  const sortedShifts = [...input.shifts].sort((a, b) =>
    a.clock_in_at.localeCompare(b.clock_in_at),
  )
  for (const shift of sortedShifts) {
    const date = manilaDate(shift.clock_in_at)
    if (date < period.start || date > period.end) continue
    const raw = shiftRawMinutes(shift)
    if (raw === null) {
      warnings.push({
        kind: 'open_shift',
        shiftId: shift.id,
        message: `Still clocked in since ${date} — not counted until closed`,
      })
      continue
    }
    if (raw > MAX_SHIFT_HOURS * 60) {
      warnings.push({
        kind: 'long_shift',
        shiftId: shift.id,
        message: `Shift on ${date} is over ${MAX_SHIFT_HOURS} hrs — not counted until fixed`,
      })
      continue
    }
    if (shift.flagged) {
      warnings.push({
        kind: 'flagged',
        shiftId: shift.id,
        message: `Shift on ${date} was edited or flagged — please double-check`,
      })
    }
    const list = byDate.get(date) ?? []
    list.push(shift)
    byDate.set(date, list)
  }

  if (periodProfiles.length === 0) {
    if (byDate.size > 0) {
      warnings.push({
        kind: 'no_profile',
        message: 'Has hours this period but no pay rate set',
      })
    }
    return { item: null, warnings }
  }

  const markedOff = new Set(
    dayMarks
      .filter((m) => m.employee_id === null || m.employee_id === employeeId)
      .map((m) => m.mark_date),
  )

  let regularMin = 0
  let overtimeMin = 0
  let lateMin = 0
  let undertimeMin = 0
  let absentDays = 0
  let daysWorked = 0
  let basePay = 0
  let overtimePay = 0
  let lateDeduction = 0
  let undertimeDeduction = 0
  let absenceDeduction = 0

  for (const date of periodDates) {
    const profile = profileOn(sortedProfiles, date)
    if (!profile) continue
    const shifts = byDate.get(date) ?? []
    const worked = shifts.reduce(
      (s, sh) => s + shiftWorkedMinutes(sh, profile, roundTo),
      0,
    )
    const scheduledMin = profile.scheduled_hours_per_day * 60
    if (shifts.length > 0) daysWorked += 1

    if (profile.pay_type === 'hourly') {
      const rate = profile.hourly_rate_cents ?? 0
      const reg = profile.overtime_enabled
        ? Math.min(worked, scheduledMin)
        : worked
      const ot = profile.overtime_enabled
        ? Math.max(0, worked - scheduledMin)
        : 0
      regularMin += reg
      overtimeMin += ot
      basePay += (reg / 60) * rate
      overtimePay += (ot / 60) * rate * profile.overtime_multiplier
      continue
    }

    // Monthly
    const daily = dailyRateCents(profile)
    const perMin = perMinuteCents(profile)
    const isRestDay = profile.rest_days.includes(dayOfWeek(date))
    const isMarkedOff = markedOff.has(date)

    if (shifts.length === 0) {
      if (!isRestDay && !isMarkedOff && date <= today) {
        absentDays += 1
        // Rounded per day so one absence is exactly one daily rate.
        absenceDeduction += Math.round(daily)
      }
      continue
    }

    if (isRestDay || isMarkedOff) {
      // Work on a day off: all of it is overtime when OT is paid.
      if (profile.overtime_enabled) {
        overtimeMin += worked
        overtimePay +=
          (worked / 60) *
          (daily / profile.scheduled_hours_per_day) *
          profile.overtime_multiplier
      } else {
        regularMin += worked
      }
      continue
    }

    const late = lateMinutes(shifts[0].clock_in_at, profile)
    // Undertime excludes the minutes already counted as late so lateness
    // isn't deducted twice.
    const under = Math.max(0, scheduledMin - worked - late)
    const ot = profile.overtime_enabled ? Math.max(0, worked - scheduledMin) : 0
    regularMin += worked - ot
    overtimeMin += ot
    overtimePay +=
      (ot / 60) *
      (daily / profile.scheduled_hours_per_day) *
      profile.overtime_multiplier
    if (profile.deduct_lates) {
      lateMin += late
      undertimeMin += under
      lateDeduction += late * perMin
      undertimeDeduction += under * perMin
    }
  }

  // Monthly base: salary / 2, prorated by the share of the period each
  // profile version covers (one profile for the whole period = exactly half).
  for (const p of periodProfiles) {
    if (p.pay_type !== 'monthly') continue
    const covered = periodDates.filter(
      (d) =>
        p.effective_from <= d &&
        (p.effective_to === null || p.effective_to >= d),
    ).length
    basePay +=
      ((p.monthly_salary_cents ?? 0) / 2) * (covered / periodDates.length)
  }

  const latest = periodProfiles[periodProfiles.length - 1]
  const parts = {
    base_pay_cents: Math.round(basePay),
    overtime_pay_cents: Math.round(overtimePay),
    late_deduction_cents: Math.round(lateDeduction),
    undertime_deduction_cents: Math.round(undertimeDeduction),
    absence_deduction_cents: absenceDeduction,
  }

  return {
    item: {
      pay_type: latest.pay_type,
      rate_snapshot_cents:
        latest.pay_type === 'hourly'
          ? (latest.hourly_rate_cents ?? 0)
          : (latest.monthly_salary_cents ?? 0),
      days_worked: daysWorked,
      regular_hours: round2(regularMin / 60),
      overtime_hours: round2(overtimeMin / 60),
      late_minutes: Math.round(lateMin),
      undertime_minutes: Math.round(undertimeMin),
      absent_days: absentDays,
      ...parts,
      ...totals(parts, input.adjustments),
    },
    warnings,
  }
}

/** True when `date` is inside a finalized or paid period — edits to
 *  attendance on that date must be rejected (the DB trigger
 *  attendance_logs_lock_guard enforces the same rule). */
export function isDateLocked(
  date: string,
  periods: Array<{ start_date: string; end_date: string; status: string }>,
): boolean {
  return periods.some(
    (p) => p.status !== 'draft' && date >= p.start_date && date <= p.end_date,
  )
}

/**
 * Staff attendance: self clock in/out for any staff login linked to a
 * payroll employee, plus the owner's Team view (see, add, fix, close
 * shifts). Pay math lives in #/lib/payroll/compute; locked-period rules are
 * also enforced by the attendance_logs_lock_guard trigger (migration 0140).
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { fetchAllRows } from '#/lib/utils/paginate'
import {
  storeLocalDateKey,
  storeLocalDateTimeToUtcIso,
} from '#/lib/utils/date-range'
import {
  isDateLocked,
  lateMinutes,
  manilaDate,
  MAX_SHIFT_HOURS,
  periodForDate,
  profileOn,
  shiftRawMinutes,
  shiftWorkedMinutes,
} from '#/lib/payroll/compute'
import {
  deleteAttendanceEntrySchema,
  saveAttendanceEntrySchema,
  teamAttendanceSchema,
} from '#/lib/validation/admin/payroll'
import { ATTENDANCE_PHOTO_BUCKET } from '#/lib/payroll/photos'
import { logStaffActivity } from './activity-log'
import { requirePayrollOwner } from './payroll-access'
import type { Database } from '#/types/database.types'

type Tables = Database['public']['Tables']
export type AttendanceLog = Tables['attendance_logs']['Row']
export type PayProfileRow = Tables['staff_pay_profiles']['Row']
export type PayrollEmployee = Tables['payroll_employees']['Row']

const DEFAULT_BREAK = { unpaid_break_minutes: 60 }

function friendlyDbError(error: { code?: string; message: string }): Error {
  if (error.code === '23505') return new Error('Already clocked in')
  if (error.code === '23514')
    return new Error('Clock-out must be after clock-in')
  return new Error(error.message)
}

/** Worked minutes using the profile in effect that day (or the default
 *  60-min break rule if there's no profile yet). */
function workedFor(shift: AttendanceLog, profiles: PayProfileRow[]): number {
  const profile = profileOn(profiles, shift.work_date)
  return shiftWorkedMinutes(shift, profile ?? DEFAULT_BREAK)
}

function isLongOpen(shift: AttendanceLog, nowMs: number): boolean {
  return (
    shift.clock_out_at === null &&
    nowMs - new Date(shift.clock_in_at).getTime() > MAX_SHIFT_HOURS * 3600_000
  )
}

async function loadProfiles(employeeIds: string[]): Promise<PayProfileRow[]> {
  if (employeeIds.length === 0) return []
  const admin = getSupabaseAdminClient()
  const { data, error } = await admin
    .from('staff_pay_profiles')
    .select('*')
    .in('employee_id', employeeIds)
    .order('effective_from')
  if (error) throw error
  return data.map((p) => ({
    ...p,
    scheduled_hours_per_day: Number(p.scheduled_hours_per_day),
    overtime_multiplier: Number(p.overtime_multiplier),
  }))
}

async function loadLockedPeriods() {
  const admin = getSupabaseAdminClient()
  const { data, error } = await admin
    .from('payroll_periods')
    .select('start_date, end_date, status')
    .neq('status', 'draft')
  if (error) throw error
  return data
}

async function findOwnEmployee(staffUserId: string) {
  const admin = getSupabaseAdminClient()
  const { data, error } = await admin
    .from('payroll_employees')
    .select('*')
    .eq('staff_user_id', staffUserId)
    .maybeSingle()
  if (error) throw error
  return data
}

// ---------------------------------------------------------------------------
// My time (every staff login)
// ---------------------------------------------------------------------------

export interface MyAttendance {
  canManagePayroll: boolean
  employee: PayrollEmployee | null
  openShift: AttendanceLog | null
  period: { start: string; end: string }
  todayMinutes: number
  periodMinutes: number
  shifts: Array<AttendanceLog & { workedMinutes: number; lateMinutes: number }>
  payslips: Array<{
    periodStart: string
    periodEnd: string
    status: string
    netPayCents: number
  }>
}

export const getMyAttendance = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MyAttendance> => {
    const staff = await requireStaff()
    const today = storeLocalDateKey(new Date().toISOString())
    const period = periodForDate(today)
    const employee = await findOwnEmployee(staff.id)
    const base = {
      canManagePayroll: staff.can_manage_payroll,
      employee,
      period,
      openShift: null,
      todayMinutes: 0,
      periodMinutes: 0,
      shifts: [],
      payslips: [],
    }
    if (!employee) return base

    const admin = getSupabaseAdminClient()
    const [shiftsRes, openRes, profiles, itemsRes] = await Promise.all([
      admin
        .from('attendance_logs')
        .select('*')
        .eq('employee_id', employee.id)
        .gte('work_date', period.start)
        .lte('work_date', period.end)
        .order('clock_in_at', { ascending: false }),
      admin
        .from('attendance_logs')
        .select('*')
        .eq('employee_id', employee.id)
        .is('clock_out_at', null)
        .maybeSingle(),
      loadProfiles([employee.id]),
      // Own pay — finalized/paid periods only.
      admin
        .from('payroll_items')
        .select(
          'net_pay_cents, payroll_periods!inner(start_date, end_date, status)',
        )
        .eq('employee_id', employee.id)
        .neq('payroll_periods.status', 'draft')
        .limit(12),
    ])
    if (shiftsRes.error) throw shiftsRes.error
    if (openRes.error) throw openRes.error
    if (itemsRes.error) throw itemsRes.error

    const shifts = shiftsRes.data.map((s) => {
      const profile = profileOn(profiles, s.work_date)
      return {
        ...s,
        workedMinutes: workedFor(s, profiles),
        lateMinutes:
          profile?.pay_type === 'monthly'
            ? lateMinutes(s.clock_in_at, profile)
            : 0,
      }
    })
    const payslips = (
      itemsRes.data as unknown as Array<{
        net_pay_cents: number
        payroll_periods: {
          start_date: string
          end_date: string
          status: string
        }
      }>
    )
      .map((i) => ({
        periodStart: i.payroll_periods.start_date,
        periodEnd: i.payroll_periods.end_date,
        status: i.payroll_periods.status,
        netPayCents: i.net_pay_cents,
      }))
      .sort((a, b) => b.periodStart.localeCompare(a.periodStart))

    return {
      ...base,
      openShift: openRes.data,
      shifts,
      todayMinutes: shifts
        .filter((s) => s.work_date === today)
        .reduce((sum, s) => sum + s.workedMinutes, 0),
      periodMinutes: shifts.reduce((sum, s) => sum + s.workedMinutes, 0),
      payslips,
    }
  },
)

async function requireOwnActiveEmployee() {
  const staff = await requireStaff()
  const employee = await findOwnEmployee(staff.id)
  if (!employee) throw new Error('Your login is not set up for attendance yet')
  if (!employee.is_active) throw new Error('Your attendance is turned off')
  return employee
}

/** Step 1 of clocking in: a one-time upload URL for the selfie, inside the
 *  caller's own folder. Uploading goes straight from the phone to storage
 *  (never base64 through a server function). */
export const createClockInPhotoUpload = createServerFn({
  method: 'POST',
}).handler(async (): Promise<{ path: string; token: string }> => {
  const employee = await requireOwnActiveEmployee()
  const today = storeLocalDateKey(new Date().toISOString())
  const path = `${employee.id}/${today}/${crypto.randomUUID()}.jpg`
  const { data, error } = await getSupabaseAdminClient()
    .storage.from(ATTENDANCE_PHOTO_BUCKET)
    .createSignedUploadUrl(path)
  if (error) throw error
  return { path, token: data.token }
})

/** Step 2: clock in, with the selfie just uploaded. A photo is required for
 *  every self clock-in. */
export const clockIn = createServerFn({ method: 'POST' })
  .validator(z.object({ photoPath: z.string().min(1).max(300) }))
  .handler(async ({ data }) => {
    const employee = await requireOwnActiveEmployee()
    const today = storeLocalDateKey(new Date().toISOString())
    // Must be a photo taken today, in this person's own folder.
    if (!data.photoPath.startsWith(`${employee.id}/${today}/`)) {
      throw new Error('Please take a new photo to clock in')
    }
    const admin = getSupabaseAdminClient()
    const { data: exists, error: existsError } = await admin.storage
      .from(ATTENDANCE_PHOTO_BUCKET)
      .exists(data.photoPath)
    if (existsError || !exists) {
      throw new Error('Photo didn’t upload — please try again')
    }
    const { error } = await admin.from('attendance_logs').insert({
      employee_id: employee.id,
      clock_in_at: new Date().toISOString(),
      source: 'self',
      clock_in_photo_path: data.photoPath,
    })
    if (error) throw friendlyDbError(error)
    return { ok: true }
  })

export const clockOut = createServerFn({ method: 'POST' }).handler(async () => {
  const staff = await requireStaff()
  const employee = await findOwnEmployee(staff.id)
  if (!employee) throw new Error('Your login is not set up for attendance yet')
  const admin = getSupabaseAdminClient()
  const { data: open, error } = await admin
    .from('attendance_logs')
    .select('*')
    .eq('employee_id', employee.id)
    .is('clock_out_at', null)
    .maybeSingle()
  if (error) throw error
  if (!open) throw new Error("You're not clocked in")
  const now = new Date()
  const long = isLongOpen(open, now.getTime())
  const { error: updError } = await admin
    .from('attendance_logs')
    .update({ clock_out_at: now.toISOString(), flagged: open.flagged || long })
    .eq('id', open.id)
  if (updError) throw friendlyDbError(updError)
  return { ok: true }
})

// ---------------------------------------------------------------------------
// Team (owner only)
// ---------------------------------------------------------------------------

/** Signed view URLs (1 hr) for clock-in selfies, keyed by storage path. */
async function signPhotoUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = [...new Set(paths)]
  const storage = getSupabaseAdminClient().storage.from(ATTENDANCE_PHOTO_BUCKET)
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await storage.createSignedUrls(
      unique.slice(i, i + 100),
      3600,
    )
    if (error) throw error
    for (const d of data) {
      if (d.path && d.signedUrl) out.set(d.path, d.signedUrl)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

export interface TeamAttendanceRow extends AttendanceLog {
  employeeName: string
  workedMinutes: number | null
  lateMinutes: number
  longOpen: boolean
  locked: boolean
  /** Short-lived signed URL for the clock-in selfie, if there is one. */
  photoUrl: string | null
}

export interface TeamAttendance {
  employees: Array<Pick<PayrollEmployee, 'id' | 'full_name' | 'is_active'>>
  rows: TeamAttendanceRow[]
  onShiftNow: Array<{
    employeeName: string
    since: string
    longOpen: boolean
    photoUrl: string | null
  }>
}

export const getTeamAttendance = createServerFn({ method: 'GET' })
  .validator(teamAttendanceSchema)
  .handler(async ({ data }): Promise<TeamAttendance> => {
    await requirePayrollOwner()
    const admin = getSupabaseAdminClient()
    const nowMs = Date.now()

    const [employeesRes, openRes, locked] = await Promise.all([
      admin
        .from('payroll_employees')
        .select('id, full_name, is_active')
        .order('full_name'),
      admin.from('attendance_logs').select('*').is('clock_out_at', null),
      loadLockedPeriods(),
    ])
    if (employeesRes.error) throw employeesRes.error
    if (openRes.error) throw openRes.error
    const names = new Map(employeesRes.data.map((e) => [e.id, e.full_name]))

    // Shifts left open past 14 hrs get flagged so they stand out.
    const stale = openRes.data.filter((s) => isLongOpen(s, nowMs) && !s.flagged)
    if (stale.length > 0) {
      const { error } = await admin
        .from('attendance_logs')
        .update({ flagged: true })
        .in(
          'id',
          stale.map((s) => s.id),
        )
      // A shift inside a locked period can't be flagged; not fatal here.
      if (error && error.code !== 'P0001') throw error
    }

    const logs = await fetchAllRows<AttendanceLog>((offset) => {
      let q = admin
        .from('attendance_logs')
        .select('*')
        .gte('work_date', data.from)
        .lte('work_date', data.to)
      if (data.employeeId) q = q.eq('employee_id', data.employeeId)
      if (data.flaggedOnly) q = q.eq('flagged', true)
      return q
        .order('clock_in_at', { ascending: false })
        .order('id')
        .range(offset, offset + 999)
    })
    const profiles = await loadProfiles(employeesRes.data.map((e) => e.id))
    const profilesBy = new Map<string, PayProfileRow[]>()
    for (const p of profiles) {
      const list = profilesBy.get(p.employee_id) ?? []
      list.push(p)
      profilesBy.set(p.employee_id, list)
    }

    const photoUrls = await signPhotoUrls(
      [...logs, ...openRes.data]
        .map((s) => s.clock_in_photo_path)
        .filter((p): p is string => !!p),
    )

    const rows = logs.map((s): TeamAttendanceRow => {
      const own = profilesBy.get(s.employee_id) ?? []
      const profile = profileOn(own, s.work_date)
      const longOpen = isLongOpen(s, nowMs)
      return {
        ...s,
        flagged: s.flagged || longOpen,
        employeeName: names.get(s.employee_id) ?? 'Unknown',
        workedMinutes: s.clock_out_at ? workedFor(s, own) : null,
        lateMinutes:
          profile?.pay_type === 'monthly'
            ? lateMinutes(s.clock_in_at, profile)
            : 0,
        longOpen,
        locked: isDateLocked(s.work_date, locked),
        photoUrl: s.clock_in_photo_path
          ? (photoUrls.get(s.clock_in_photo_path) ?? null)
          : null,
      }
    })

    return {
      employees: employeesRes.data,
      rows,
      onShiftNow: openRes.data
        .map((s) => ({
          employeeName: names.get(s.employee_id) ?? 'Unknown',
          since: s.clock_in_at,
          longOpen: isLongOpen(s, nowMs),
          photoUrl: s.clock_in_photo_path
            ? (photoUrls.get(s.clock_in_photo_path) ?? null)
            : null,
        }))
        .sort((a, b) => a.since.localeCompare(b.since)),
    }
  })

/** Add a shift, or edit/close an existing one. Every edit needs a note and
 *  marks the shift manual + flagged. */
export const saveAttendanceEntry = createServerFn({ method: 'POST' })
  .validator(saveAttendanceEntrySchema)
  .handler(async ({ data }) => {
    const staff = await requirePayrollOwner()
    const admin = getSupabaseAdminClient()
    const clockInIso = storeLocalDateTimeToUtcIso(data.clockIn)
    const clockOutIso = data.clockOut
      ? storeLocalDateTimeToUtcIso(data.clockOut)
      : null
    if (clockOutIso && clockOutIso <= clockInIso) {
      throw new Error('Clock-out must be after clock-in')
    }
    if (
      clockOutIso &&
      shiftRawMinutes({
        id: '',
        clock_in_at: clockInIso,
        clock_out_at: clockOutIso,
        break_minutes: null,
      })! >
        MAX_SHIFT_HOURS * 60
    ) {
      throw new Error(`A shift can't be longer than ${MAX_SHIFT_HOURS} hours`)
    }

    const locked = await loadLockedPeriods()
    if (isDateLocked(manilaDate(clockInIso), locked)) {
      throw new Error('That date is in a finalized payroll period')
    }

    let before: AttendanceLog | null = null
    if (data.id) {
      const { data: existing, error } = await admin
        .from('attendance_logs')
        .select('*')
        .eq('id', data.id)
        .single()
      if (error) throw error
      if (isDateLocked(existing.work_date, locked)) {
        throw new Error('This shift is in a finalized payroll period')
      }
      before = existing
    }

    const values = {
      employee_id: data.employeeId,
      clock_in_at: clockInIso,
      clock_out_at: clockOutIso,
      break_minutes: data.breakMinutes,
      note: data.note,
      source: 'manual' as const,
      flagged: true,
      edited_by: staff.id,
    }
    const result = data.id
      ? await admin
          .from('attendance_logs')
          .update(values)
          .eq('id', data.id)
          .select('id')
          .single()
      : await admin.from('attendance_logs').insert(values).select('id').single()
    if (result.error) throw friendlyDbError(result.error)

    await logStaffActivity(
      staff,
      data.id ? 'attendance.edit' : 'attendance.add',
      'attendance_log',
      result.data.id,
      {
        note: data.note,
        before: before && {
          clock_in_at: before.clock_in_at,
          clock_out_at: before.clock_out_at,
          break_minutes: before.break_minutes,
        },
        after: {
          clock_in_at: clockInIso,
          clock_out_at: clockOutIso,
          break_minutes: data.breakMinutes,
        },
      },
    )
    return { ok: true }
  })

export const deleteAttendanceEntry = createServerFn({ method: 'POST' })
  .validator(deleteAttendanceEntrySchema)
  .handler(async ({ data }) => {
    const staff = await requirePayrollOwner()
    const admin = getSupabaseAdminClient()
    const { data: existing, error } = await admin
      .from('attendance_logs')
      .select('*')
      .eq('id', data.id)
      .single()
    if (error) throw error
    const { error: delError } = await admin
      .from('attendance_logs')
      .delete()
      .eq('id', data.id)
    if (delError) throw friendlyDbError(delError)
    await logStaffActivity(
      staff,
      'attendance.delete',
      'attendance_log',
      data.id,
      {
        note: data.note,
        before: existing,
      },
    )
    return { ok: true }
  })

/**
 * Payroll (owner only): staff list + versioned pay rates, holidays/leave,
 * and semi-monthly periods (compute → review/adjust → finalize → paid).
 * The math is in #/lib/payroll/compute; this file only loads and saves.
 * Finalized/paid periods are locked by DB triggers (migration 0140).
 */
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { fetchAllRows } from '#/lib/utils/paginate'
import { storeLocalDateKey } from '#/lib/utils/date-range'
import {
  addDays,
  computePayrollItem,
  nextPeriod,
  periodForDate,
  totals,
} from '#/lib/payroll/compute'
import type { PayrollWarning } from '#/lib/payroll/compute'
import {
  getPayrollSchema,
  periodIdSchema,
  saveDayMarkSchema,
  saveEmployeeSchema,
  savePayProfileSchema,
  updatePayrollItemSchema,
} from '#/lib/validation/admin/payroll'
import { z } from 'zod'
import { logStaffActivity } from './activity-log'
import { requirePayrollOwner } from './payroll-access'
import type {
  AttendanceLog,
  PayProfileRow,
  PayrollEmployee,
} from './attendance'
import type { Database } from '#/types/database.types'

type Tables = Database['public']['Tables']
export type PayrollPeriod = Tables['payroll_periods']['Row']
export type PayrollItem = Tables['payroll_items']['Row']
export type DayMarkRow = Tables['attendance_day_marks']['Row']

function normalizeProfile(p: PayProfileRow): PayProfileRow {
  return {
    ...p,
    scheduled_hours_per_day: Number(p.scheduled_hours_per_day),
    overtime_multiplier: Number(p.overtime_multiplier),
  }
}

function dbError(error: { code?: string; message: string }): Error {
  return new Error(error.message)
}

// ---------------------------------------------------------------------------
// Staff & pay rates
// ---------------------------------------------------------------------------

export interface PayrollStaff {
  employees: Array<
    PayrollEmployee & {
      loginName: string | null
      current: PayProfileRow | null
      history: PayProfileRow[]
    }
  >
  logins: Array<{ id: string; full_name: string; linked: boolean }>
}

export const getPayrollStaff = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PayrollStaff> => {
    await requirePayrollOwner()
    const admin = getSupabaseAdminClient()
    const [empRes, profRes, staffRes] = await Promise.all([
      admin.from('payroll_employees').select('*').order('full_name'),
      admin.from('staff_pay_profiles').select('*').order('effective_from', {
        ascending: false,
      }),
      admin
        .from('staff_users')
        .select('id, full_name')
        .eq('is_active', true)
        .order('full_name'),
    ])
    if (empRes.error) throw empRes.error
    if (profRes.error) throw profRes.error
    if (staffRes.error) throw staffRes.error
    const loginNames = new Map(staffRes.data.map((s) => [s.id, s.full_name]))
    const linked = new Set(empRes.data.map((e) => e.staff_user_id))
    return {
      employees: empRes.data.map((e) => {
        const history = profRes.data
          .filter((p) => p.employee_id === e.id)
          .map(normalizeProfile)
        return {
          ...e,
          loginName: e.staff_user_id
            ? (loginNames.get(e.staff_user_id) ?? null)
            : null,
          current: history.find((p) => p.effective_to === null) ?? null,
          history,
        }
      }),
      logins: staffRes.data.map((s) => ({ ...s, linked: linked.has(s.id) })),
    }
  },
)

export const saveEmployee = createServerFn({ method: 'POST' })
  .validator(saveEmployeeSchema)
  .handler(async ({ data }) => {
    const staff = await requirePayrollOwner()
    const admin = getSupabaseAdminClient()
    const values = {
      full_name: data.fullName,
      staff_user_id: data.staffUserId,
      is_active: data.isActive,
      updated_at: new Date().toISOString(),
    }
    const result = data.id
      ? await admin
          .from('payroll_employees')
          .update(values)
          .eq('id', data.id)
          .select('id')
          .single()
      : await admin
          .from('payroll_employees')
          .insert(values)
          .select('id')
          .single()
    if (result.error) {
      if (result.error.code === '23505') {
        throw new Error('That login is already linked to another staff member')
      }
      throw dbError(result.error)
    }
    await logStaffActivity(
      staff,
      data.id ? 'payroll.employee_update' : 'payroll.employee_create',
      'payroll_employee',
      result.data.id,
      { ...values },
    )
    return { id: result.data.id }
  })

/** Saving a rate change closes the current version the day before
 *  `effectiveFrom` and starts a new one, so earlier payroll is unaffected.
 *  Same start date as the current version = a correction, updated in place. */
export const savePayProfile = createServerFn({ method: 'POST' })
  .validator(savePayProfileSchema)
  .handler(async ({ data }) => {
    const staff = await requirePayrollOwner()
    const admin = getSupabaseAdminClient()
    const values = {
      employee_id: data.employeeId,
      pay_type: data.payType,
      hourly_rate_cents:
        data.payType === 'hourly' ? data.hourlyRateCents : null,
      monthly_salary_cents:
        data.payType === 'monthly' ? data.monthlySalaryCents : null,
      work_days_per_week: data.workDaysPerWeek,
      rest_days: data.restDays,
      scheduled_start: data.scheduledStart,
      scheduled_hours_per_day: data.scheduledHoursPerDay,
      unpaid_break_minutes: data.unpaidBreakMinutes,
      late_grace_minutes: data.lateGraceMinutes,
      deduct_lates: data.deductLates,
      overtime_enabled: data.overtimeEnabled,
      overtime_multiplier: data.overtimeMultiplier,
      effective_from: data.effectiveFrom,
      effective_to: null,
      updated_at: new Date().toISOString(),
    }

    const { data: current, error } = await admin
      .from('staff_pay_profiles')
      .select('*')
      .eq('employee_id', data.employeeId)
      .is('effective_to', null)
      .maybeSingle()
    if (error) throw error

    let profileId: string
    if (current && current.effective_from === data.effectiveFrom) {
      const { error: updError } = await admin
        .from('staff_pay_profiles')
        .update(values)
        .eq('id', current.id)
      if (updError) throw dbError(updError)
      profileId = current.id
    } else {
      if (current && current.effective_from > data.effectiveFrom) {
        throw new Error(
          `The new rate must start after ${current.effective_from}, when the current one started`,
        )
      }
      if (current) {
        const { error: closeError } = await admin
          .from('staff_pay_profiles')
          .update({ effective_to: addDays(data.effectiveFrom, -1) })
          .eq('id', current.id)
        if (closeError) throw dbError(closeError)
      }
      const { data: inserted, error: insError } = await admin
        .from('staff_pay_profiles')
        .insert(values)
        .select('id')
        .single()
      if (insError) throw dbError(insError)
      profileId = inserted.id
    }

    await logStaffActivity(
      staff,
      'payroll.rate_save',
      'staff_pay_profile',
      profileId,
      {
        employee_id: data.employeeId,
        pay_type: data.payType,
        hourly_rate_cents: values.hourly_rate_cents,
        monthly_salary_cents: values.monthly_salary_cents,
        effective_from: data.effectiveFrom,
      },
    )
    return { ok: true }
  })

// ---------------------------------------------------------------------------
// Holidays & leave
// ---------------------------------------------------------------------------

export const saveDayMark = createServerFn({ method: 'POST' })
  .validator(saveDayMarkSchema)
  .handler(async ({ data }) => {
    const staff = await requirePayrollOwner()
    const admin = getSupabaseAdminClient()
    const { data: row, error } = await admin
      .from('attendance_day_marks')
      .insert({
        employee_id: data.employeeId,
        mark_date: data.markDate,
        kind: data.kind,
        note: data.note,
      })
      .select('id')
      .single()
    if (error) {
      if (error.code === '23505') throw new Error('That day is already marked')
      throw dbError(error)
    }
    await logStaffActivity(
      staff,
      'payroll.day_mark_add',
      'attendance_day_mark',
      row.id,
      {
        ...data,
      },
    )
    return { ok: true }
  })

export const deleteDayMark = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const staff = await requirePayrollOwner()
    const admin = getSupabaseAdminClient()
    const { error } = await admin
      .from('attendance_day_marks')
      .delete()
      .eq('id', data.id)
    if (error) throw dbError(error)
    await logStaffActivity(
      staff,
      'payroll.day_mark_delete',
      'attendance_day_mark',
      data.id,
    )
    return { ok: true }
  })

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

/** Make sure the current and next semi-monthly periods exist. */
async function ensurePeriods(today: string) {
  const admin = getSupabaseAdminClient()
  const current = periodForDate(today)
  const next = nextPeriod(current)
  const { error } = await admin.from('payroll_periods').upsert(
    [
      { start_date: current.start, end_date: current.end },
      { start_date: next.start, end_date: next.end },
    ],
    { onConflict: 'start_date,end_date', ignoreDuplicates: true },
  )
  if (error) throw error
  return current
}

interface PeriodInputs {
  employees: PayrollEmployee[]
  profiles: PayProfileRow[]
  shifts: AttendanceLog[]
  dayMarks: DayMarkRow[]
  items: PayrollItem[]
}

async function loadPeriodInputs(period: PayrollPeriod): Promise<PeriodInputs> {
  const admin = getSupabaseAdminClient()
  const [empRes, profRes, marksRes, itemsRes, shifts] = await Promise.all([
    admin.from('payroll_employees').select('*').order('full_name'),
    admin
      .from('staff_pay_profiles')
      .select('*')
      .lte('effective_from', period.end_date)
      .or(`effective_to.is.null,effective_to.gte.${period.start_date}`),
    admin
      .from('attendance_day_marks')
      .select('*')
      .gte('mark_date', period.start_date)
      .lte('mark_date', period.end_date)
      .order('mark_date'),
    admin.from('payroll_items').select('*').eq('period_id', period.id),
    fetchAllRows<AttendanceLog>((offset) =>
      admin
        .from('attendance_logs')
        .select('*')
        .gte('work_date', period.start_date)
        .lte('work_date', period.end_date)
        .order('clock_in_at')
        .order('id')
        .range(offset, offset + 999),
    ),
  ])
  if (empRes.error) throw empRes.error
  if (profRes.error) throw profRes.error
  if (marksRes.error) throw marksRes.error
  if (itemsRes.error) throw itemsRes.error
  return {
    employees: empRes.data,
    profiles: profRes.data.map(normalizeProfile),
    dayMarks: marksRes.data,
    items: itemsRes.data,
    shifts,
  }
}

function computeAll(period: PayrollPeriod, inputs: PeriodInputs) {
  const today = storeLocalDateKey(new Date().toISOString())
  const itemsByEmployee = new Map(inputs.items.map((i) => [i.employee_id, i]))
  return inputs.employees.map((employee) => {
    const existing = itemsByEmployee.get(employee.id)
    const result = computePayrollItem({
      employeeId: employee.id,
      period: { start: period.start_date, end: period.end_date },
      profiles: inputs.profiles.filter((p) => p.employee_id === employee.id),
      shifts: inputs.shifts.filter((s) => s.employee_id === employee.id),
      dayMarks: inputs.dayMarks,
      adjustments: existing?.adjustments ?? [],
      today,
    })
    return { employee, existing, ...result }
  })
}

export interface PayrollPageData {
  periods: PayrollPeriod[]
  period: PayrollPeriod
  items: Array<PayrollItem & { employeeName: string }>
  warnings: Array<PayrollWarning & { employeeName: string }>
  dayMarks: Array<DayMarkRow & { employeeName: string | null }>
  employees: Array<Pick<PayrollEmployee, 'id' | 'full_name' | 'is_active'>>
  /** Hours changed after the last Compute — finalize is blocked until re-run. */
  stale: boolean
}

export const getPayroll = createServerFn({ method: 'GET' })
  .validator(getPayrollSchema)
  .handler(async ({ data }): Promise<PayrollPageData> => {
    await requirePayrollOwner()
    const admin = getSupabaseAdminClient()
    const today = storeLocalDateKey(new Date().toISOString())
    const current = await ensurePeriods(today)

    const { data: periods, error } = await admin
      .from('payroll_periods')
      .select('*')
      .order('start_date', { ascending: false })
      .limit(48)
    if (error) throw error
    const period =
      periods.find((p) => p.id === data.periodId) ??
      periods.find((p) => p.start_date === current.start)!

    const inputs = await loadPeriodInputs(period)
    const names = new Map(inputs.employees.map((e) => [e.id, e.full_name]))
    // Warnings are recomputed live so they reflect edits made since Compute.
    const warnings =
      period.status === 'draft'
        ? computeAll(period, inputs).flatMap((r) =>
            r.warnings.map((w) => ({
              ...w,
              employeeName: r.employee.full_name,
            })),
          )
        : []
    const stale =
      period.status === 'draft' &&
      period.computed_at !== null &&
      inputs.shifts.some((s) => s.updated_at > period.computed_at!)

    return {
      periods,
      period,
      items: inputs.items
        .map((i) => ({
          ...i,
          employeeName: names.get(i.employee_id) ?? 'Unknown',
        }))
        .sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
      warnings,
      dayMarks: inputs.dayMarks.map((m) => ({
        ...m,
        employeeName: m.employee_id ? (names.get(m.employee_id) ?? null) : null,
      })),
      employees: inputs.employees.map(({ id, full_name, is_active }) => ({
        id,
        full_name,
        is_active,
      })),
      stale,
    }
  })

async function loadPeriod(periodId: string): Promise<PayrollPeriod> {
  const admin = getSupabaseAdminClient()
  const { data, error } = await admin
    .from('payroll_periods')
    .select('*')
    .eq('id', periodId)
    .single()
  if (error) throw error
  return data
}

/** Rebuild the draft items from attendance. Idempotent: same attendance +
 *  rates → same items; adjustments and notes already entered are kept. */
export const computePayroll = createServerFn({ method: 'POST' })
  .validator(periodIdSchema)
  .handler(async ({ data }) => {
    const staff = await requirePayrollOwner()
    const period = await loadPeriod(data.periodId)
    if (period.status !== 'draft') {
      throw new Error('This period is finalized and can’t be recomputed')
    }
    const admin = getSupabaseAdminClient()
    const results = computeAll(period, await loadPeriodInputs(period))

    const rows = results
      .filter((r) => r.item !== null)
      .map((r) => ({
        period_id: period.id,
        employee_id: r.employee.id,
        ...r.item!,
        adjustments: r.existing?.adjustments ?? [],
        notes: r.existing?.notes ?? null,
      }))
    if (rows.length > 0) {
      const { error } = await admin
        .from('payroll_items')
        .upsert(rows, { onConflict: 'period_id,employee_id' })
      if (error) throw dbError(error)
    }
    const dropIds = results
      .filter((r) => r.item === null && r.existing)
      .map((r) => r.existing!.id)
    if (dropIds.length > 0) {
      const { error } = await admin
        .from('payroll_items')
        .delete()
        .in('id', dropIds)
      if (error) throw dbError(error)
    }
    const { error } = await admin
      .from('payroll_periods')
      .update({ computed_at: new Date().toISOString() })
      .eq('id', period.id)
    if (error) throw dbError(error)

    await logStaffActivity(
      staff,
      'payroll.compute',
      'payroll_period',
      period.id,
      {
        items: rows.length,
      },
    )
    return { items: rows.length }
  })

export const updatePayrollItem = createServerFn({ method: 'POST' })
  .validator(updatePayrollItemSchema)
  .handler(async ({ data }) => {
    const staff = await requirePayrollOwner()
    const admin = getSupabaseAdminClient()
    const { data: item, error } = await admin
      .from('payroll_items')
      .select('*')
      .eq('id', data.itemId)
      .single()
    if (error) throw error
    const { error: updError } = await admin
      .from('payroll_items')
      .update({
        adjustments: data.adjustments,
        notes: data.notes,
        ...totals(item, data.adjustments),
      })
      .eq('id', item.id)
    if (updError) throw dbError(updError)
    await logStaffActivity(staff, 'payroll.adjust', 'payroll_item', item.id, {
      before: item.adjustments,
      after: data.adjustments,
    })
    return { ok: true }
  })

export const finalizePayroll = createServerFn({ method: 'POST' })
  .validator(periodIdSchema)
  .handler(async ({ data }) => {
    const staff = await requirePayrollOwner()
    const period = await loadPeriod(data.periodId)
    if (period.status !== 'draft') throw new Error('Already finalized')
    const today = storeLocalDateKey(new Date().toISOString())
    if (period.end_date >= today) {
      throw new Error('Wait until the period has ended before finalizing')
    }
    if (!period.computed_at) throw new Error('Press Compute first')
    const inputs = await loadPeriodInputs(period)
    if (inputs.shifts.some((s) => s.clock_out_at === null)) {
      throw new Error(
        'Someone is still clocked in for this period — close it first',
      )
    }
    if (inputs.shifts.some((s) => s.updated_at > period.computed_at!)) {
      throw new Error(
        'Hours changed since the last Compute — press Compute again',
      )
    }
    const admin = getSupabaseAdminClient()
    const { error } = await admin
      .from('payroll_periods')
      .update({
        status: 'finalized',
        finalized_at: new Date().toISOString(),
        finalized_by: staff.id,
      })
      .eq('id', period.id)
    if (error) throw dbError(error)
    await logStaffActivity(
      staff,
      'payroll.finalize',
      'payroll_period',
      period.id,
      {
        start_date: period.start_date,
        end_date: period.end_date,
        total_net_cents: inputs.items.reduce((s, i) => s + i.net_pay_cents, 0),
      },
    )
    return { ok: true }
  })

export const markPayrollPaid = createServerFn({ method: 'POST' })
  .validator(periodIdSchema)
  .handler(async ({ data }) => {
    const staff = await requirePayrollOwner()
    const admin = getSupabaseAdminClient()
    const { error } = await admin
      .from('payroll_periods')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', data.periodId)
    if (error) throw dbError(error)
    await logStaffActivity(
      staff,
      'payroll.mark_paid',
      'payroll_period',
      data.periodId,
    )
    return { ok: true }
  })

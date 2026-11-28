import { describe, expect, it } from 'vitest'
import {
  computePayrollItem,
  dailyRateCents,
  datesBetween,
  dayOfWeek,
  isDateLocked,
  lateMinutes,
  manilaDate,
  nextPeriod,
  periodForDate,
  perMinuteCents,
  shiftWorkedMinutes,
} from './compute'
import type { PayProfile, Shift } from './compute'

/** Manila wall-clock → ISO instant. */
const at = (date: string, time: string) =>
  new Date(`${date}T${time}:00+08:00`).toISOString()

let n = 0
const shift = (
  date: string,
  inTime: string,
  outTime: string,
  outDate = date,
): Shift => ({
  id: `s${++n}`,
  clock_in_at: at(date, inTime),
  clock_out_at: at(outDate, outTime),
  break_minutes: null,
})

const base: PayProfile = {
  pay_type: 'hourly',
  hourly_rate_cents: 10_000,
  monthly_salary_cents: null,
  work_days_per_week: 6,
  rest_days: [0],
  scheduled_start: '09:00',
  scheduled_hours_per_day: 8,
  unpaid_break_minutes: 60,
  late_grace_minutes: 10,
  deduct_lates: true,
  overtime_enabled: false,
  overtime_multiplier: 1.25,
  effective_from: '2026-01-01',
  effective_to: null,
}
const monthly: PayProfile = {
  ...base,
  pay_type: 'monthly',
  hourly_rate_cents: null,
  monthly_salary_cents: 1_800_000,
}
const period = { start: '2026-12-01', end: '2026-12-15' }

function run(profile: PayProfile, shifts: Shift[], today = period.end) {
  return computePayrollItem({
    employeeId: 'e1',
    period,
    profiles: [profile],
    shifts,
    dayMarks: [],
    adjustments: [],
    today,
  })
}

describe('acceptance checks', () => {
  it('1. hourly ₱100/hr, 09:00–18:00 with 60-min break → 8 hrs → ₱800', () => {
    const s = shift('2026-12-01', '09:00', '18:00')
    expect(shiftWorkedMinutes(s, base)).toBe(480)
    const { item } = run(base, [s])
    expect(item?.regular_hours).toBe(8)
    expect(item?.base_pay_cents).toBe(80_000)
    expect(item?.net_pay_cents).toBe(80_000)
  })

  it('2. OT enabled, 09:00–20:00 → 8 regular + 2 OT → ₱1,050', () => {
    const { item } = run({ ...base, overtime_enabled: true }, [
      shift('2026-12-01', '09:00', '20:00'),
    ])
    expect(item?.regular_hours).toBe(8)
    expect(item?.overtime_hours).toBe(2)
    expect(item?.base_pay_cents).toBe(80_000)
    expect(item?.overtime_pay_cents).toBe(25_000)
    expect(item?.gross_pay_cents).toBe(105_000)
  })

  it('3. monthly ₱18,000 6-day: daily ₱690.10, base ₱9,000, absence −₱690.10, 30 min late −₱43.13', () => {
    expect(Math.round(dailyRateCents(monthly))).toBe(69_010)
    expect(Math.round(perMinuteCents(monthly) * 30)).toBe(4_313)

    const shifts: Shift[] = []
    for (const d of datesBetween(period.start, period.end)) {
      if (dayOfWeek(d) === 0) continue // Sunday rest day
      if (d === '2026-12-02') continue // absent
      shifts.push(
        d === '2026-12-03'
          ? shift(d, '09:30', '18:00') // 30 min late
          : shift(d, '09:00', '18:00'),
      )
    }
    const { item } = run(monthly, shifts)
    expect(item?.base_pay_cents).toBe(900_000)
    expect(item?.absent_days).toBe(1)
    expect(item?.absence_deduction_cents).toBe(69_010)
    expect(item?.late_minutes).toBe(30)
    expect(item?.late_deduction_cents).toBe(4_313)
    expect(item?.undertime_minutes).toBe(0)
    expect(item?.net_pay_cents).toBe(900_000 - 69_010 - 4_313)
  })

  it('4. a 22:00 → 06:00 shift belongs to the clock-in date (Manila)', () => {
    const s = shift('2026-12-04', '22:00', '06:00', '2026-12-05')
    expect(manilaDate(s.clock_in_at)).toBe('2026-12-04')
    const { item } = run(base, [s])
    expect(item?.days_worked).toBe(1)
    expect(item?.regular_hours).toBe(7) // 8h − 60 min break
  })

  it('5. dates inside a finalized period are locked', () => {
    const periods = [
      { start_date: '2026-11-16', end_date: '2026-11-30', status: 'finalized' },
      { start_date: '2026-12-01', end_date: '2026-12-15', status: 'draft' },
    ]
    expect(isDateLocked('2026-11-20', periods)).toBe(true)
    expect(isDateLocked('2026-12-02', periods)).toBe(false)
    expect(
      isDateLocked('2026-11-20', [{ ...periods[0], status: 'paid' }]),
    ).toBe(true)
  })

  it('6. re-running compute on the same inputs gives identical results', () => {
    const shifts = [
      shift('2026-12-01', '09:12', '18:40'),
      shift('2026-12-02', '08:55', '17:01'),
    ]
    const input = {
      employeeId: 'e1',
      period,
      profiles: [monthly],
      shifts,
      dayMarks: [],
      adjustments: [{ label: 'Bonus', amount_cents: 50_000 }],
      today: period.end,
    }
    expect(computePayrollItem(input)).toEqual(computePayrollItem(input))
  })
})

describe('rules', () => {
  it('rounds worked time to the nearest 15 minutes', () => {
    expect(
      shiftWorkedMinutes(shift('2026-12-01', '09:00', '18:07'), base),
    ).toBe(480)
    expect(
      shiftWorkedMinutes(shift('2026-12-01', '09:00', '18:08'), base),
    ).toBe(495)
  })

  it('takes no break from shifts of 5 hrs or less', () => {
    expect(
      shiftWorkedMinutes(shift('2026-12-01', '09:00', '14:00'), base),
    ).toBe(300)
  })

  it('uses the owner break override when set', () => {
    const s = { ...shift('2026-12-01', '09:00', '18:00'), break_minutes: 30 }
    expect(shiftWorkedMinutes(s, base)).toBe(510)
  })

  it('ignores lateness inside the grace period', () => {
    expect(lateMinutes(at('2026-12-01', '09:10'), base)).toBe(0)
    expect(lateMinutes(at('2026-12-01', '09:11'), base)).toBe(11)
  })

  it('hourly staff get no late or absence deductions', () => {
    const { item } = run(base, [shift('2026-12-01', '10:00', '19:00')])
    expect(item?.late_deduction_cents).toBe(0)
    expect(item?.absence_deduction_cents).toBe(0)
  })

  it('does not count future days or holidays as absences', () => {
    const r = computePayrollItem({
      employeeId: 'e1',
      period,
      profiles: [monthly],
      shifts: [],
      dayMarks: [
        { employee_id: null, mark_date: '2026-12-01', kind: 'holiday' },
        { employee_id: 'e1', mark_date: '2026-12-02', kind: 'leave' },
        { employee_id: 'other', mark_date: '2026-12-03', kind: 'leave' },
      ],
      adjustments: [],
      today: '2026-12-03',
    })
    expect(r.item?.absent_days).toBe(1) // only Dec 3
  })

  it('leaves open and >14 hr shifts out, with warnings', () => {
    const open = {
      ...shift('2026-12-01', '09:00', '18:00'),
      clock_out_at: null,
    }
    const long = shift('2026-12-02', '06:00', '22:00')
    const r = run(base, [open, long])
    expect(r.item?.regular_hours).toBe(0)
    expect(r.warnings.map((w) => w.kind).sort()).toEqual([
      'long_shift',
      'open_shift',
    ])
  })

  it('warns when someone has hours but no pay rate', () => {
    const r = computePayrollItem({
      employeeId: 'e1',
      period,
      profiles: [],
      shifts: [shift('2026-12-01', '09:00', '18:00')],
      dayMarks: [],
      adjustments: [],
      today: period.end,
    })
    expect(r.item).toBeNull()
    expect(r.warnings[0].kind).toBe('no_profile')
  })

  it('uses the rate in effect on each shift date', () => {
    const r = computePayrollItem({
      employeeId: 'e1',
      period,
      profiles: [
        { ...base, effective_to: '2026-12-07' },
        { ...base, hourly_rate_cents: 12_000, effective_from: '2026-12-08' },
      ],
      shifts: [
        shift('2026-12-01', '09:00', '18:00'),
        shift('2026-12-08', '09:00', '18:00'),
      ],
      dayMarks: [],
      adjustments: [],
      today: period.end,
    })
    expect(r.item?.base_pay_cents).toBe(80_000 + 96_000)
    expect(r.item?.rate_snapshot_cents).toBe(12_000)
  })

  it('applies adjustments: + to gross, − to net', () => {
    const r = computePayrollItem({
      employeeId: 'e1',
      period,
      profiles: [base],
      shifts: [shift('2026-12-01', '09:00', '18:00')],
      dayMarks: [],
      adjustments: [
        { label: 'Bonus', amount_cents: 10_000 },
        { label: 'Cash advance', amount_cents: -20_000 },
      ],
      today: period.end,
    })
    expect(r.item?.gross_pay_cents).toBe(90_000)
    expect(r.item?.net_pay_cents).toBe(70_000)
  })

  it('splits months into 1–15 and 16–end periods', () => {
    expect(periodForDate('2026-02-20')).toEqual({
      start: '2026-02-16',
      end: '2026-02-28',
    })
    expect(periodForDate('2026-12-15')).toEqual({
      start: '2026-12-01',
      end: '2026-12-15',
    })
    expect(nextPeriod({ end: '2026-12-31' })).toEqual({
      start: '2027-01-01',
      end: '2027-01-15',
    })
  })
})

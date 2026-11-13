/**
 * Pure date helpers for the admin DateRangePicker's month calendar. Dates
 * are plain YYYY-MM-DD strings throughout (the same shape every analytics
 * page's `from`/`to` search params already use), with month math done in
 * UTC so the host's own timezone never shifts a day.
 */

export interface MonthRef {
  year: number
  /** 0-11 */
  month: number
}

export function monthOf(date: string): MonthRef {
  const [y, m] = date.split('-').map(Number)
  return { year: y, month: m - 1 }
}

export function addMonths(ref: MonthRef, delta: number): MonthRef {
  const d = new Date(Date.UTC(ref.year, ref.month + delta, 1))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() }
}

export function isoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10)
}

/** The month's days laid out Sunday-first, with `null` padding before the
 *  1st so each entry lands in its weekday column. */
export function monthGrid(ref: MonthRef): (string | null)[] {
  const firstWeekday = new Date(Date.UTC(ref.year, ref.month, 1)).getUTCDay()
  const daysInMonth = new Date(
    Date.UTC(ref.year, ref.month + 1, 0),
  ).getUTCDate()
  return [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      isoDate(ref.year, ref.month, i + 1),
    ),
  ]
}

export function monthLabel(ref: MonthRef): string {
  return new Date(Date.UTC(ref.year, ref.month, 1)).toLocaleDateString(
    'en-US',
    { month: 'long', year: 'numeric', timeZone: 'UTC' },
  )
}

export interface RangeSelection {
  from: string | null
  to: string | null
}

/**
 * Two clicks pick a range: the first sets the start, the second sets the
 * end. Clicking a day before the start (while the end is still open) moves
 * the start instead; a click after a complete range starts a new one.
 * Clicking the start day again makes a single-day range.
 */
export function nextRangeSelection(
  current: RangeSelection,
  clicked: string,
): RangeSelection {
  if (!current.from || current.to) return { from: clicked, to: null }
  if (clicked < current.from) return { from: clicked, to: null }
  return { from: current.from, to: clicked }
}

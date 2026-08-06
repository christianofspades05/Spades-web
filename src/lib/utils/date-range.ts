/**
 * The store operates in the Philippines (UTC+8). All "today"/"this month"/etc.
 * calendar math below is computed against this fixed offset rather than the
 * host's local timezone — the loader that calls this can run server-side
 * (Vercel, UTC) or client-side (the owner's browser, already UTC+8), and using
 * `new Date()`'s local getters directly would silently resolve to a different
 * calendar day depending on which one ran, especially during the PH-morning/
 * UTC-evening window where the two disagree on what day it is.
 */
const STORE_UTC_OFFSET_MS = 8 * 60 * 60_000
const STORE_UTC_OFFSET = '+08:00'

/** `now()` shifted so its UTC getters read as the store's local wall-clock time. */
function storeNow(): Date {
  return new Date(Date.now() + STORE_UTC_OFFSET_MS)
}

/** The store-local (UTC+8) hour (0-23) for an arbitrary instant — defaults to right now. Used for time-of-day gates like the Lalamove checkout window (see lib/checkout/lalamove-eligibility.ts). */
export function storeLocalHour(date: Date = new Date()): number {
  return new Date(date.getTime() + STORE_UTC_OFFSET_MS).getUTCHours()
}

/** Converts a UTC timestamp (e.g. a `placed_at` column value) into the store-local YYYY-MM-DD it falls on. */
export function storeLocalDateKey(isoUtc: string): string {
  return new Date(new Date(isoUtc).getTime() + STORE_UTC_OFFSET_MS)
    .toISOString()
    .slice(0, 10)
}

/** Converts a UTC timestamp into a store-local hourly bucket key (YYYY-MM-DDTHH). */
export function storeLocalHourKey(isoUtc: string): string {
  return new Date(new Date(isoUtc).getTime() + STORE_UTC_OFFSET_MS)
    .toISOString()
    .slice(0, 13)
}

/**
 * Converts an `<input type="datetime-local">` value (YYYY-MM-DDTHH:mm, no
 * timezone of its own) into the correct UTC ISO instant, treating it as
 * store-local (PH) wall-clock time — never the runtime's own local
 * timezone. Without this, a value entered on a server (Vercel, always UTC)
 * or a browser set to some other timezone gets silently misinterpreted,
 * shifting the stored instant by however many hours that runtime differs
 * from PH (e.g. entering "11:30 PM" and having it saved as if it were
 * already UTC quietly moves it 8 hours later).
 */
export function storeLocalDateTimeToUtcIso(localDateTime: string): string {
  return new Date(`${localDateTime}:00${STORE_UTC_OFFSET}`).toISOString()
}

/** The inverse of storeLocalDateTimeToUtcIso — a UTC ISO instant (e.g. a
 *  discounts.starts_at column value) formatted as a store-local (PH)
 *  <input type="datetime-local"> value. */
export function utcIsoToStoreLocalDateTimeInput(isoUtc: string): string {
  return new Date(new Date(isoUtc).getTime() + STORE_UTC_OFFSET_MS)
    .toISOString()
    .slice(0, 16)
}

/**
 * Converts a store-local `from`/`to` calendar-date range (as resolved by
 * `resolveDateRange`) into the actual UTC instant boundaries to query —
 * store-local midnight, not UTC midnight.
 */
export function storeRangeToUtcBounds(
  from: string,
  to: string,
): { start: string; end: string } {
  return {
    start: `${from}T00:00:00.000${STORE_UTC_OFFSET}`,
    end: `${to}T23:59:59.999${STORE_UTC_OFFSET}`,
  }
}

/** Date-range presets for admin analytics pages (Home, Orders). */
export const DATE_RANGE_PRESETS = [
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'this_month',
  'last_month',
  'this_year',
  'custom',
] as const

export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number]

export const DATE_RANGE_LABELS: Record<DateRangePreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  last_90_days: 'Last 90 days',
  this_month: 'This month',
  last_month: 'Last month',
  this_year: 'This year',
  custom: 'Custom',
}

export interface ResolvedDateRange {
  from: string
  to: string
}

// All arithmetic below uses UTC getters/setters on `storeNow()`'s already-
// shifted instant, so the result reflects PH wall-clock date math regardless
// of which timezone the host (server or browser) actually runs in.
function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Store-local YYYY-MM-DD that was `n` days before today (n=0 → today). */
export function daysAgo(n: number): string {
  const d = storeNow()
  d.setUTCDate(d.getUTCDate() - n)
  return toISODate(d)
}

export function resolveDateRange(
  preset: DateRangePreset,
  custom?: { from?: string; to?: string },
): ResolvedDateRange {
  const now = storeNow()
  const today = toISODate(now)

  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      const y = daysAgo(1)
      return { from: y, to: y }
    }
    case 'last_7_days':
      return { from: daysAgo(6), to: today }
    case 'last_30_days':
      return { from: daysAgo(29), to: today }
    case 'last_90_days':
      return { from: daysAgo(89), to: today }
    case 'this_month':
      return {
        from: toISODate(
          new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        ),
        to: today,
      }
    case 'last_month':
      return {
        from: toISODate(
          new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
        ),
        to: toISODate(
          new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)),
        ),
      }
    case 'this_year':
      return {
        from: toISODate(new Date(Date.UTC(now.getUTCFullYear(), 0, 1))),
        to: today,
      }
    case 'custom':
      return {
        from: custom?.from ?? daysAgo(29),
        to: custom?.to ?? today,
      }
  }
}

/** The immediately-preceding period of equal length, for trend comparisons. */
export function previousPeriod(from: string, to: string): ResolvedDateRange {
  const fromDate = new Date(`${from}T00:00:00Z`)
  const toDate = new Date(`${to}T00:00:00Z`)
  const lengthDays =
    Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1

  const prevTo = new Date(fromDate)
  prevTo.setUTCDate(prevTo.getUTCDate() - 1)
  const prevFrom = new Date(prevTo)
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (lengthDays - 1))

  return { from: toISODate(prevFrom), to: toISODate(prevTo) }
}

/** % change from `previous` to `current`, rounded to 1 decimal. `null` when previous is 0 (undefined trend). */
export function percentChange(
  current: number,
  previous: number,
): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return Math.round(((current - previous) / previous) * 1000) / 10
}

export function formatDateRangeLabel(range: ResolvedDateRange): string {
  if (range.from === range.to) {
    return new Date(`${range.from}T00:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }
  const fromLabel = new Date(`${range.from}T00:00:00`).toLocaleDateString(
    'en-US',
    { month: 'short', day: 'numeric' },
  )
  const toLabel = new Date(`${range.to}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `${fromLabel} – ${toLabel}`
}

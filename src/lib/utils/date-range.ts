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

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return toISODate(d)
}

export function resolveDateRange(
  preset: DateRangePreset,
  custom?: { from?: string; to?: string },
): ResolvedDateRange {
  const today = toISODate(new Date())
  const now = new Date()

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
        from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: today,
      }
    case 'last_month':
      return {
        from: toISODate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: toISODate(new Date(now.getFullYear(), now.getMonth(), 0)),
      }
    case 'this_year':
      return { from: toISODate(new Date(now.getFullYear(), 0, 1)), to: today }
    case 'custom':
      return {
        from: custom?.from ?? daysAgo(29),
        to: custom?.to ?? today,
      }
  }
}

/** The immediately-preceding period of equal length, for trend comparisons. */
export function previousPeriod(from: string, to: string): ResolvedDateRange {
  const fromDate = new Date(`${from}T00:00:00`)
  const toDate = new Date(`${to}T00:00:00`)
  const lengthDays =
    Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1

  const prevTo = new Date(fromDate)
  prevTo.setDate(prevTo.getDate() - 1)
  const prevFrom = new Date(prevTo)
  prevFrom.setDate(prevFrom.getDate() - (lengthDays - 1))

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

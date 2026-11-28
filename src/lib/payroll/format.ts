/** Display helpers for attendance/payroll — always Asia/Manila. */
const TZ = 'Asia/Manila'

export function formatManilaTime(iso: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function formatManilaDate(dateKey: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${dateKey}T00:00:00Z`))
}

export function formatPeriod(start: string, end: string): string {
  const f = (d: string, withYear: boolean) =>
    new Intl.DateTimeFormat('en-PH', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
    }).format(new Date(`${d}T00:00:00Z`))
  return `${f(start, false)} – ${f(end, true)}`
}

/** 485 → "8h 5m". */
export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes)
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h === 0) return `${rest}m`
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

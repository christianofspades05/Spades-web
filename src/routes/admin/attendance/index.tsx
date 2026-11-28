import { useEffect, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { LogIn, LogOut } from 'lucide-react'
import { clockIn, clockOut, getMyAttendance } from '#/server/admin/attendance'
import { getErrorMessage } from '#/lib/utils/errors'
import { formatCentsAsPHP } from '#/lib/utils/money'
import {
  formatManilaDate,
  formatManilaTime,
  formatMinutes,
  formatPeriod,
} from '#/lib/payroll/format'
import {
  ATTENDANCE_PAGE_CLASS,
  AttendanceTabs,
} from '#/components/admin/AttendanceTabs'
import { Badge } from '#/components/admin/Badge'
import { Card } from '#/components/admin/Card'
import { PageHeader } from '#/components/admin/PageHeader'

export const Route = createFileRoute('/admin/attendance/')({
  loader: () => getMyAttendance(),
  component: MyTimePage,
})

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

const manilaClock = (ms: number) =>
  new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms))

const manilaToday = (ms: number) =>
  new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(ms))

function MyTimePage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const now = useNow(15_000)

  async function toggle() {
    setBusy(true)
    setError(null)
    try {
      if (data.openShift) await clockOut()
      else await clockIn()
      await router.invalidate()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const onShift = !!data.openShift
  const liveMinutes = data.openShift
    ? (now - new Date(data.openShift.clock_in_at).getTime()) / 60_000
    : 0
  const firstName = data.employee?.full_name.split(' ')[0]

  return (
    <div className={ATTENDANCE_PAGE_CLASS}>
      <div className="hidden md:block">
        <PageHeader
          title="Attendance & Payroll"
          subtitle={`This pay period: ${formatPeriod(data.period.start, data.period.end)}`}
        />
      </div>
      <AttendanceTabs active="mine" isOwner={data.canManagePayroll} />

      {!data.employee ? (
        <Card className="p-6">
          <p className="text-sm text-neutral-700">
            Your login isn’t set up for attendance yet. Ask the owner to add you
            on the Pay Rates tab.
          </p>
        </Card>
      ) : (
        <div className="mx-auto flex max-w-xl flex-col gap-4">
          {/* Clock card — on phones this is the whole screen's focus. */}
          <div
            className={`rounded-3xl p-6 text-center shadow-sm md:p-8 ${
              onShift
                ? 'bg-neutral-950 text-white'
                : 'border border-neutral-200 bg-white text-neutral-900'
            }`}
          >
            <p
              className={`text-sm ${onShift ? 'text-neutral-400' : 'text-neutral-500'}`}
            >
              {firstName ? `Hi, ${firstName} · ` : ''}
              {manilaToday(now)}
            </p>
            <p className="mt-2 text-5xl font-semibold tracking-tight tabular-nums md:text-6xl">
              {manilaClock(now)}
            </p>
            <div className="mt-3 flex justify-center">
              <span
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${
                  onShift
                    ? 'bg-green-500/15 text-green-400'
                    : 'bg-neutral-100 text-neutral-600'
                }`}
              >
                <span
                  className={`size-2 rounded-full ${onShift ? 'animate-pulse bg-green-400' : 'bg-neutral-400'}`}
                />
                {onShift
                  ? `On shift since ${formatManilaTime(data.openShift!.clock_in_at)}`
                  : 'Not clocked in'}
              </span>
            </div>
            {onShift && (
              <p className="mt-2 text-sm text-neutral-400">
                {formatMinutes(liveMinutes)} so far
              </p>
            )}

            <button
              type="button"
              onClick={toggle}
              disabled={busy || !data.employee.is_active}
              className={`mt-6 flex h-20 w-full items-center justify-center gap-3 rounded-2xl text-xl font-semibold text-white shadow-md transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
                onShift
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {busy ? (
                '…'
              ) : onShift ? (
                <>
                  <LogOut size={24} /> Clock Out
                </>
              ) : (
                <>
                  <LogIn size={24} /> Clock In
                </>
              )}
            </button>
            {!data.employee.is_active && (
              <p className="mt-3 text-sm text-neutral-500">
                Your attendance is turned off.
              </p>
            )}
            {error && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <p className="text-xs text-neutral-500 uppercase">Today</p>
              <p className="mt-1 text-2xl font-semibold">
                {formatMinutes(data.todayMinutes)}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-neutral-500 uppercase">This period</p>
              <p className="mt-1 text-2xl font-semibold">
                {formatMinutes(data.periodMinutes)}
              </p>
              <p className="mt-0.5 text-xs text-neutral-400">
                {formatPeriod(data.period.start, data.period.end)}
              </p>
            </Card>
          </div>

          <section>
            <h2 className="mb-2 px-1 text-sm font-semibold text-neutral-900">
              My shifts
            </h2>
            {data.shifts.length === 0 ? (
              <Card className="p-4 text-sm text-neutral-500">
                No shifts yet this period.
              </Card>
            ) : (
              <Card className="divide-y divide-neutral-100">
                {data.shifts.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-900">
                        {formatManilaDate(s.work_date)}
                      </p>
                      <p className="text-sm text-neutral-500">
                        {formatManilaTime(s.clock_in_at)} –{' '}
                        {s.clock_out_at
                          ? formatManilaTime(s.clock_out_at)
                          : 'now'}
                      </p>
                      {(s.lateMinutes > 0 || s.source === 'manual') && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {s.lateMinutes > 0 && (
                            <Badge tone="warning">Late {s.lateMinutes}m</Badge>
                          )}
                          {s.source === 'manual' && (
                            <Badge tone="neutral">Edited</Badge>
                          )}
                        </div>
                      )}
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-neutral-900">
                      {s.clock_out_at
                        ? formatMinutes(s.workedMinutes)
                        : 'On shift'}
                    </p>
                  </div>
                ))}
              </Card>
            )}
          </section>

          {data.payslips.length > 0 && (
            <section>
              <h2 className="mb-2 px-1 text-sm font-semibold text-neutral-900">
                My pay
              </h2>
              <Card className="divide-y divide-neutral-100">
                {data.payslips.map((p) => (
                  <div
                    key={p.periodStart}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-neutral-900">
                        {formatPeriod(p.periodStart, p.periodEnd)}
                      </p>
                      <Badge tone={p.status === 'paid' ? 'success' : 'info'}>
                        {p.status === 'paid' ? 'Paid' : 'Finalized'}
                      </Badge>
                    </div>
                    <p className="text-base font-semibold">
                      {formatCentsAsPHP(p.netPayCents)}
                    </p>
                  </div>
                ))}
              </Card>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

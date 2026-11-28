import { useEffect, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { clockIn, clockOut, getMyAttendance } from '#/server/admin/attendance'
import { getErrorMessage } from '#/lib/utils/errors'
import { formatCentsAsPHP } from '#/lib/utils/money'
import {
  formatManilaDate,
  formatManilaTime,
  formatMinutes,
  formatPeriod,
} from '#/lib/payroll/format'
import { AttendanceTabs } from '#/components/admin/AttendanceTabs'
import { Badge } from '#/components/admin/Badge'
import { Card } from '#/components/admin/Card'
import { PageHeader } from '#/components/admin/PageHeader'
import {
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

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

function MyTimePage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const now = useNow(30_000)

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

  const liveMinutes = data.openShift
    ? (now - new Date(data.openShift.clock_in_at).getTime()) / 60_000
    : 0

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Attendance & Payroll"
        subtitle={`This pay period: ${formatPeriod(data.period.start, data.period.end)}`}
      />
      <AttendanceTabs active="mine" isOwner={data.canManagePayroll} />

      {!data.employee ? (
        <Card className="p-6">
          <p className="text-sm text-neutral-700">
            Your login isn’t set up for attendance yet. Ask the owner to add you
            on the Pay Rates tab.
          </p>
        </Card>
      ) : (
        <>
          <Card className="flex flex-col items-center gap-4 p-8 text-center">
            <p className="text-sm text-neutral-500">
              {data.openShift
                ? `On shift since ${formatManilaTime(data.openShift.clock_in_at)} · ${formatMinutes(liveMinutes)} so far`
                : 'You’re not clocked in'}
            </p>
            <button
              type="button"
              onClick={toggle}
              disabled={busy || !data.employee.is_active}
              className={`h-32 w-32 rounded-full text-lg font-semibold text-white shadow-md transition disabled:cursor-not-allowed disabled:opacity-50 sm:h-40 sm:w-40 sm:text-xl ${
                data.openShift
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {busy ? '…' : data.openShift ? 'Clock Out' : 'Clock In'}
            </button>
            {!data.employee.is_active && (
              <p className="text-sm text-neutral-500">
                Your attendance is turned off.
              </p>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
          </Card>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <Card className="p-4">
              <p className="text-xs text-neutral-500 uppercase">Today</p>
              <p className="mt-1 text-xl font-semibold">
                {formatMinutes(data.todayMinutes)}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-neutral-500 uppercase">This period</p>
              <p className="mt-1 text-xl font-semibold">
                {formatMinutes(data.periodMinutes)}
              </p>
            </Card>
          </div>

          <h2 className="mt-8 mb-2 text-sm font-semibold text-neutral-900">
            My shifts this period
          </h2>
          <div className={`${tableWrapperClassName} overflow-x-auto`}>
            <table className="w-full">
              <thead>
                <tr>
                  {['Date', 'In', 'Out', 'Hours', ''].map((h) => (
                    <th key={h} className={tableHeadClassName}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.shifts.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className={`${tableCellClassName} text-neutral-500`}
                    >
                      No shifts yet this period.
                    </td>
                  </tr>
                )}
                {data.shifts.map((s) => (
                  <tr key={s.id} className={tableRowClassName}>
                    <td className={tableCellClassName}>
                      {formatManilaDate(s.work_date)}
                    </td>
                    <td className={tableCellClassName}>
                      {formatManilaTime(s.clock_in_at)}
                    </td>
                    <td className={tableCellClassName}>
                      {s.clock_out_at ? formatManilaTime(s.clock_out_at) : '—'}
                    </td>
                    <td className={tableCellClassName}>
                      {s.clock_out_at
                        ? formatMinutes(s.workedMinutes)
                        : 'On shift'}
                    </td>
                    <td className={tableCellClassName}>
                      <div className="flex gap-1">
                        {s.lateMinutes > 0 && (
                          <Badge tone="warning">Late {s.lateMinutes}m</Badge>
                        )}
                        {s.source === 'manual' && (
                          <Badge tone="neutral">Edited</Badge>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.payslips.length > 0 && (
            <>
              <h2 className="mt-8 mb-2 text-sm font-semibold text-neutral-900">
                My pay
              </h2>
              <div className={tableWrapperClassName}>
                <table className="w-full">
                  <tbody>
                    {data.payslips.map((p) => (
                      <tr key={p.periodStart} className={tableRowClassName}>
                        <td className={tableCellClassName}>
                          {formatPeriod(p.periodStart, p.periodEnd)}
                        </td>
                        <td className={tableCellClassName}>
                          <Badge
                            tone={p.status === 'paid' ? 'success' : 'info'}
                          >
                            {p.status === 'paid' ? 'Paid' : 'Finalized'}
                          </Badge>
                        </td>
                        <td
                          className={`${tableCellClassName} text-right font-medium`}
                        >
                          {formatCentsAsPHP(p.netPayCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

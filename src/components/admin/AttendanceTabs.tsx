import { Link } from '@tanstack/react-router'
import { getErrorMessage } from '#/lib/utils/errors'
import { PageHeader } from './PageHeader'

/** Tabs across the top of Attendance & Payroll. Team, Payroll and Pay Rates
 *  are owner-only (staff_users.can_manage_payroll); everyone else just sees
 *  My Time, so the tab bar is hidden for them. */
export function AttendanceTabs({
  active,
  isOwner,
}: {
  active: 'mine' | 'team' | 'payroll' | 'staff'
  isOwner: boolean
}) {
  if (!isOwner) return null
  const tab = (isActive: boolean) =>
    `border-b-2 px-3 pb-2 text-xs font-semibold tracking-wider whitespace-nowrap uppercase transition ${
      isActive
        ? 'border-neutral-900 text-neutral-900'
        : 'border-transparent text-neutral-400 hover:text-neutral-700'
    }`
  return (
    <div className="mb-6 flex items-center gap-1 overflow-x-auto border-b border-neutral-200">
      <Link to="/admin/attendance" className={tab(active === 'mine')}>
        My Time
      </Link>
      <Link
        to="/admin/attendance/team"
        search={{ range: 'last_7_days', flagged: false }}
        className={tab(active === 'team')}
      >
        Team
      </Link>
      <Link
        to="/admin/attendance/payroll"
        className={tab(active === 'payroll')}
      >
        Payroll
      </Link>
      <Link to="/admin/attendance/staff" className={tab(active === 'staff')}>
        Pay Rates
      </Link>
    </div>
  )
}

/** errorComponent for the owner-only tabs. */
export function OwnerOnlyError({ error }: { error: unknown }) {
  const msg = getErrorMessage(error)
  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader title="Attendance & Payroll" />
      <p className="mt-2 text-sm text-neutral-600">
        {msg.includes('owner') ? 'Only the owner can view this page.' : msg}
      </p>
    </div>
  )
}

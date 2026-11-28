import { Link } from '@tanstack/react-router'
import { Clock, Coins, UserCog, Users } from 'lucide-react'
import { getErrorMessage } from '#/lib/utils/errors'
import { PageHeader } from './PageHeader'

type TabKey = 'mine' | 'team' | 'payroll' | 'staff'

/** Tabs for Attendance & Payroll. Team, Payroll and Pay Rates are
 *  owner-only (staff_users.can_manage_payroll), so for everyone else there
 *  are no tabs at all.
 *
 *  Desktop: tabs across the top. Phones: an app-style bar fixed to the
 *  bottom of the screen (pages add bottom padding for it, see
 *  ATTENDANCE_PAGE_CLASS). */
export function AttendanceTabs({
  active,
  isOwner,
}: {
  active: TabKey
  isOwner: boolean
}) {
  if (!isOwner) return null
  const top = (isActive: boolean) =>
    `border-b-2 px-3 pb-2 text-xs font-semibold tracking-wider whitespace-nowrap uppercase transition ${
      isActive
        ? 'border-neutral-900 text-neutral-900'
        : 'border-transparent text-neutral-400 hover:text-neutral-700'
    }`
  const bottom = (isActive: boolean) =>
    `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
      isActive ? 'text-neutral-950' : 'text-neutral-400'
    }`
  const teamSearch = { range: 'last_7_days', flagged: false } as const

  return (
    <>
      <div className="mb-6 hidden items-center gap-1 border-b border-neutral-200 md:flex">
        <Link to="/admin/attendance" className={top(active === 'mine')}>
          My Time
        </Link>
        <Link
          to="/admin/attendance/team"
          search={teamSearch}
          className={top(active === 'team')}
        >
          Team
        </Link>
        <Link
          to="/admin/attendance/payroll"
          className={top(active === 'payroll')}
        >
          Payroll
        </Link>
        <Link to="/admin/attendance/staff" className={top(active === 'staff')}>
          Pay Rates
        </Link>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-neutral-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <Link to="/admin/attendance" className={bottom(active === 'mine')}>
          <Clock size={20} strokeWidth={active === 'mine' ? 2.5 : 2} />
          My Time
        </Link>
        <Link
          to="/admin/attendance/team"
          search={teamSearch}
          className={bottom(active === 'team')}
        >
          <Users size={20} strokeWidth={active === 'team' ? 2.5 : 2} />
          Team
        </Link>
        <Link
          to="/admin/attendance/payroll"
          className={bottom(active === 'payroll')}
        >
          <Coins size={20} strokeWidth={active === 'payroll' ? 2.5 : 2} />
          Payroll
        </Link>
        <Link
          to="/admin/attendance/staff"
          className={bottom(active === 'staff')}
        >
          <UserCog size={20} strokeWidth={active === 'staff' ? 2.5 : 2} />
          Pay Rates
        </Link>
      </nav>
    </>
  )
}

/** Page wrapper padding — extra bottom room on phones for the tab bar. */
export const ATTENDANCE_PAGE_CLASS = 'w-full px-4 pt-4 pb-28 sm:px-8 md:py-10'

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

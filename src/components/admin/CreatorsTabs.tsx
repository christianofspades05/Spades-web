import { Link } from '@tanstack/react-router'

/** Tabs across the top of Creators & Affiliates: the creator list and the
 *  "is this creator worth it?" analytics (routes/admin/creators/analytics). */
export function CreatorsTabs({ active }: { active: 'creators' | 'analytics' }) {
  const tab = (isActive: boolean) =>
    `border-b-2 px-3 pb-2 text-xs font-semibold tracking-wider uppercase transition ${
      isActive
        ? 'border-neutral-900 text-neutral-900'
        : 'border-transparent text-neutral-400 hover:text-neutral-700'
    }`
  return (
    <div className="mb-6 flex items-center gap-1 border-b border-neutral-200">
      <Link to="/admin/creators" className={tab(active === 'creators')}>
        Creators
      </Link>
      <Link
        to="/admin/creators/analytics"
        search={{ range: 'this_month', allTime: false, tz: 'ph' }}
        className={tab(active === 'analytics')}
      >
        Analytics
      </Link>
    </div>
  )
}

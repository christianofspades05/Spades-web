import { useEffect, useRef, useState } from 'react'
import {
  createFileRoute,
  Outlet,
  redirect,
  useRouterState,
} from '@tanstack/react-router'
import { Menu, X } from 'lucide-react'
import { getStaffSession } from '#/server/admin/auth'
import { AdminNav } from '#/components/admin/AdminNav'
import { getUnreadCustomerReplyCount } from '#/server/admin/order-emails'
import { useVisibleInterval } from '#/lib/hooks/useVisibleInterval'
import {
  notifySafely,
  requestNotificationPermissionIfNeeded,
} from '#/lib/notifications'

// Polled (rather than pushed) since this app has no realtime/websocket
// infra elsewhere — cheap enough (a single COUNT query) to run this often
// without needing one. The dropdown's actual reply list is fetched
// separately by AdminNav itself, only when it's opened.
const UNREAD_REPLIES_POLL_MS = 30_000

export const Route = createFileRoute('/admin')({
  beforeLoad: async () => {
    const staff = await getStaffSession()
    if (!staff) throw redirect({ to: '/admin/login' })
    return { staff }
  },
  component: AdminLayout,
})

const NAV_COLLAPSED_STORAGE_KEY = 'admin-nav-collapsed'

function AdminLayout() {
  const { staff } = Route.useRouteContext()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  // null until the first poll resolves — distinguishes "just loaded, don't
  // notify for whatever was already unread" from a real subsequent increase.
  const previousUnreadCountRef = useRef<number | null>(null)
  // Defaults to expanded during SSR/first paint (localStorage isn't
  // available server-side) and syncs to the stored preference right after
  // mount — a one-frame flash beats a hydration mismatch.
  const [navCollapsed, setNavCollapsed] = useState(false)
  useEffect(() => {
    if (localStorage.getItem(NAV_COLLAPSED_STORAGE_KEY) === '1') {
      setNavCollapsed(true)
    }
  }, [])
  useEffect(() => {
    localStorage.setItem(NAV_COLLAPSED_STORAGE_KEY, navCollapsed ? '1' : '0')
  }, [navCollapsed])
  // Refetches on every navigation too, not just the interval — visiting the
  // order an unread reply points to marks it read server-side
  // (listOrderEmailMessages), so the badge should clear right away rather
  // than up to UNREAD_REPLIES_POLL_MS late.
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  async function pollUnreadCount() {
    try {
      const count = await getUnreadCustomerReplyCount()
      const previous = previousUnreadCountRef.current
      if (previous !== null && count > previous) {
        const newReplies = count - previous
        notifySafely(
          'New customer reply',
          newReplies === 1
            ? 'A customer replied to a failed-delivery or order email.'
            : `${newReplies} customers replied to failed-delivery or order emails.`,
        )
      }
      previousUnreadCountRef.current = count
      setUnreadCount(count)
    } catch {
      // Transient failure — next poll retries; the bell just won't
      // update this cycle.
    }
  }

  // Asks once per browser (never re-prompts after a grant/deny) so a new
  // reply can surface as a real desktop notification, not just the nav
  // bell's badge — the badge alone is easy to miss if staff aren't already
  // looking at the sidebar.
  useEffect(() => {
    requestNotificationPermissionIfNeeded()
  }, [])

  useEffect(() => {
    void pollUnreadCount()
  }, [pathname])
  useVisibleInterval(pollUnreadCount, UNREAD_REPLIES_POLL_MS)

  return (
    <div className="flex min-h-screen">
      <AdminNav
        staffRole={staff.role}
        unreadCount={unreadCount}
        collapsed={navCollapsed}
        onToggleCollapse={() => setNavCollapsed((v) => !v)}
        className={`hidden shrink-0 border-r lg:flex ${
          navCollapsed ? 'w-16' : 'w-60'
        }`}
      />

      <div
        className={`fixed inset-0 z-40 lg:hidden ${mobileNavOpen ? '' : 'pointer-events-none'}`}
      >
        <div
          onClick={() => setMobileNavOpen(false)}
          className={`absolute inset-0 bg-black/40 transition-opacity ${
            mobileNavOpen ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <AdminNav
          staffRole={staff.role}
          unreadCount={unreadCount}
          onNavigate={() => setMobileNavOpen(false)}
          className={`absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r shadow-xl transition-transform duration-200 ${
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        />
      </div>

      <div className="flex min-h-screen flex-1 flex-col bg-neutral-50">
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100"
          >
            {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <img src="/logo-black.png" alt="Spades" className="h-4 w-auto" />
        </div>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

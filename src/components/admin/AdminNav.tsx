import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  BadgePercent,
  BarChart3,
  Bell,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  EyeOff,
  Globe,
  Home,
  LayoutTemplate,
  LogOut,
  Mail,
  Package,
  PackageSearch,
  Plug,
  Settings,
  ShoppingBag,
  Star,
  Store,
  TrendingUp,
  Truck,
  Undo2,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { listCustomerReplies } from '#/server/admin/order-emails'
import type { StaffRole } from '#/types/entities'

const PRODUCTS_SUB_LINKS = [
  { to: '/admin/collections', label: 'Collections' },
  { to: '/admin/inventory', label: 'Inventory' },
  { to: '/admin/stock-audit', label: 'Stock Audit' },
  { to: '/admin/pre-orders', label: 'Pre-Orders' },
] as const

const ORDERS_SUB_LINKS = [
  { to: '/admin/orders/lalamove', label: 'Lalamove Orders' },
] as const

const ANALYTICS_SUB_LINKS = [
  { to: '/admin/analytics/sales', label: 'Sales', icon: TrendingUp },
  { to: '/admin/analytics/profit', label: 'Profit', icon: Wallet },
  {
    to: '/admin/analytics/product-analytics',
    label: 'Product Analytics',
    icon: PackageSearch,
  },
  {
    to: '/admin/analytics/cancelled-returns',
    label: 'Cancelled and Returns',
    icon: Undo2,
  },
  { to: '/admin/analytics/visitors', label: 'Visitors', icon: Eye },
  {
    to: '/admin/analytics/inventory-value',
    label: 'Inventory Value',
    icon: Warehouse,
  },
] as const

const CUSTOMER_REPLIES_PAGE_SIZE = 10

/** Shared classes for a single-icon nav row — centralized so every plain
 *  link (and the collapsed/expanded variants) stay visually consistent. */
function navLinkClassName(active: boolean, collapsed: boolean): string {
  const base = 'flex items-center gap-2.5 rounded-md py-2 text-sm font-medium'
  const alignment = collapsed ? 'justify-center px-2' : 'px-3'
  const tone = active
    ? 'bg-neutral-100 text-neutral-950'
    : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950'
  return `${base} ${alignment} ${tone}`
}

export function AdminNav({
  className = '',
  onNavigate,
  staffRole,
  unreadCount,
  collapsed = false,
  onToggleCollapse,
}: {
  className?: string
  onNavigate?: () => void
  /** Settings is only visible to super_admin — every other role's own
   *  requireStaff(['super_admin']) check in server/admin/settings.ts would
   *  reject them anyway, and without this the link was shown to everyone,
   *  crashing to a raw "something went wrong" for any staff member who
   *  clicked it. */
  staffRole: StaffRole
  /** Unread count for the bell's badge — polled from admin.tsx and shared
   *  by both AdminNav mounts (desktop sidebar + mobile drawer) so it's only
   *  fetched once. The dropdown's own full reply list below is fetched
   *  independently by whichever mount actually gets opened. */
  unreadCount: number
  /** Icon-only rail mode — only meaningful for the desktop sidebar mount;
   *  the mobile drawer mount never passes this (it has its own overlay
   *  width and doesn't need to save space). */
  collapsed?: boolean
  onToggleCollapse?: () => void
}) {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [expanded, setExpanded] = useState(false)
  const [ordersExpanded, setOrdersExpanded] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)
  const [repliesPage, setRepliesPage] = useState(1)
  const [replies, setReplies] = useState<{
    items: Awaited<ReturnType<typeof listCustomerReplies>>['items']
    total: number
  } | null>(null)
  const [repliesLoading, setRepliesLoading] = useState(false)

  useEffect(() => {
    if (!notifOpen) return
    let cancelled = false
    setRepliesLoading(true)
    listCustomerReplies({ data: { page: repliesPage } })
      .then((result) => {
        if (!cancelled) setReplies(result)
      })
      .catch(() => {
        // Left as-is — the dropdown just keeps showing whatever it last had
        // (or the empty state) rather than a broken error UI.
      })
      .finally(() => {
        if (!cancelled) setRepliesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [notifOpen, repliesPage])

  useEffect(() => {
    if (!notifOpen) return
    function handleClick(event: MouseEvent) {
      if (
        notifRef.current &&
        !notifRef.current.contains(event.target as Node)
      ) {
        setNotifOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [notifOpen])

  const underProducts =
    pathname.startsWith('/admin/products') ||
    PRODUCTS_SUB_LINKS.some((link) => pathname.startsWith(link.to))
  const productsOpen = !collapsed && (expanded || underProducts)

  const underOrdersSubLinks = ORDERS_SUB_LINKS.some((link) =>
    pathname.startsWith(link.to),
  )
  const ordersOpen = !collapsed && (ordersExpanded || underOrdersSubLinks)

  async function handleSignOut() {
    await getSupabaseBrowserClient().auth.signOut()
    await navigate({ to: '/admin/login' })
  }

  const notifButton = (
    <div ref={notifRef} className="relative">
      <button
        type="button"
        onClick={() => setNotifOpen((v) => !v)}
        aria-label="Customer reply notifications"
        className="relative flex size-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
      >
        <Bell size={18} strokeWidth={2} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] leading-[16px] font-semibold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {notifOpen && (
        <div className="absolute top-full left-0 z-50 mt-1 w-72 max-w-[min(18rem,calc(100vw-2rem))] rounded-md border border-neutral-200 bg-white py-1 shadow-lg">
          <p className="px-3 py-2 text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
            Customer replies
          </p>
          {!replies || replies.items.length === 0 ? (
            <p className="px-3 py-3 text-sm text-neutral-400">
              {repliesLoading ? 'Loading…' : 'No replies yet.'}
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {replies.items.map((reply) => (
                <li key={reply.id}>
                  <Link
                    to="/admin/orders/$orderId"
                    params={{ orderId: reply.orderId }}
                    onClick={() => {
                      setNotifOpen(false)
                      onNavigate?.()
                    }}
                    className="flex items-start gap-2 px-3 py-2 text-sm hover:bg-neutral-50"
                  >
                    {!reply.read && (
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-red-500" />
                    )}
                    <div
                      className={`min-w-0 flex-1 ${reply.read ? 'pl-3.5' : ''}`}
                    >
                      <p
                        className={`${reply.read ? 'font-normal text-neutral-600' : 'font-medium text-neutral-900'}`}
                      >
                        Order {reply.orderNumber}
                      </p>
                      <p className="mt-0.5 truncate text-neutral-500">
                        {reply.bodyText ?? '(no message)'}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {replies && replies.total > CUSTOMER_REPLIES_PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-neutral-100 px-3 py-2 text-xs text-neutral-500">
              <button
                type="button"
                disabled={repliesPage <= 1}
                onClick={() => setRepliesPage((p) => Math.max(1, p - 1))}
                className="font-medium hover:text-neutral-900 disabled:pointer-events-none disabled:opacity-30"
              >
                Previous
              </button>
              <span>
                Page {repliesPage} of{' '}
                {Math.ceil(replies.total / CUSTOMER_REPLIES_PAGE_SIZE)}
              </span>
              <button
                type="button"
                disabled={
                  repliesPage >=
                  Math.ceil(replies.total / CUSTOMER_REPLIES_PAGE_SIZE)
                }
                onClick={() => setRepliesPage((p) => p + 1)}
                className="font-medium hover:text-neutral-900 disabled:pointer-events-none disabled:opacity-30"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )

  const toggleButton = onToggleCollapse && (
    <button
      type="button"
      onClick={onToggleCollapse}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className="flex size-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
    >
      {collapsed ? (
        <ChevronsRight size={18} strokeWidth={2} />
      ) : (
        <ChevronsLeft size={18} strokeWidth={2} />
      )}
    </button>
  )

  return (
    <aside className={`flex flex-col border-neutral-200 bg-white ${className}`}>
      {collapsed ? (
        <div className="flex flex-col items-center gap-2 px-2 py-4">
          {toggleButton}
          {notifButton}
        </div>
      ) : (
        <div className="flex items-start justify-between px-4 py-5">
          <div>
            <img src="/logo-black.png" alt="Spades" className="h-5 w-auto" />
            <p className="mt-1 text-xs text-neutral-500">Admin</p>
          </div>
          <div className="flex items-center gap-1">
            {toggleButton}
            {notifButton}
          </div>
        </div>
      )}

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2">
        <Link
          to="/admin"
          onClick={onNavigate}
          title={collapsed ? 'Home' : undefined}
          className={navLinkClassName(pathname === '/admin', collapsed)}
        >
          <Home size={17} strokeWidth={2} className="shrink-0" />
          {!collapsed && 'Home'}
        </Link>

        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          title={collapsed ? 'Online Store' : undefined}
          className={navLinkClassName(false, collapsed)}
        >
          <Store size={17} strokeWidth={2} className="shrink-0" />
          {!collapsed && 'Online Store'}
        </a>

        <div
          className={`flex items-center rounded-md ${
            pathname.startsWith('/admin/products')
              ? 'bg-neutral-100 text-neutral-950'
              : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950'
          }`}
        >
          <Link
            to="/admin/products"
            onClick={onNavigate}
            title={collapsed ? 'Products' : undefined}
            className={`flex flex-1 items-center gap-2.5 py-2 text-sm font-medium ${
              collapsed ? 'justify-center px-2' : 'px-3'
            }`}
          >
            <Package size={17} strokeWidth={2} className="shrink-0" />
            {!collapsed && 'Products'}
          </Link>
          {!collapsed && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="px-2 py-2 text-neutral-400 hover:text-neutral-700"
              aria-label={productsOpen ? 'Collapse' : 'Expand'}
            >
              {productsOpen ? (
                <ChevronDown size={15} />
              ) : (
                <ChevronRight size={15} />
              )}
            </button>
          )}
        </div>

        {productsOpen && (
          <div className="mb-1 flex flex-col gap-0.5 pl-7">
            {PRODUCTS_SUB_LINKS.map((link) => {
              const isActive = pathname.startsWith(link.to)
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={onNavigate}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    isActive
                      ? 'bg-neutral-100 text-neutral-950'
                      : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-950'
                  }`}
                >
                  {link.label}
                </Link>
              )
            })}
          </div>
        )}

        <div
          className={`flex items-center rounded-md ${
            pathname.startsWith('/admin/orders') && !underOrdersSubLinks
              ? 'bg-neutral-100 text-neutral-950'
              : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950'
          }`}
        >
          <Link
            to="/admin/orders"
            onClick={onNavigate}
            title={collapsed ? 'Orders' : undefined}
            className={`flex flex-1 items-center gap-2.5 py-2 text-sm font-medium ${
              collapsed ? 'justify-center px-2' : 'px-3'
            }`}
          >
            <ShoppingBag size={17} strokeWidth={2} className="shrink-0" />
            {!collapsed && 'Orders'}
          </Link>
          {!collapsed && (
            <button
              type="button"
              onClick={() => setOrdersExpanded((v) => !v)}
              className="px-2 py-2 text-neutral-400 hover:text-neutral-700"
              aria-label={ordersOpen ? 'Collapse' : 'Expand'}
            >
              {ordersOpen ? (
                <ChevronDown size={15} />
              ) : (
                <ChevronRight size={15} />
              )}
            </button>
          )}
        </div>

        {ordersOpen && (
          <div className="mb-1 flex flex-col gap-0.5 pl-7">
            {ORDERS_SUB_LINKS.map((link) => {
              const isActive = pathname.startsWith(link.to)
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={onNavigate}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    isActive
                      ? 'bg-neutral-100 text-neutral-950'
                      : 'text-neutral-500 hover:bg-neutral-50 hover:text-neutral-950'
                  }`}
                >
                  {link.label}
                </Link>
              )
            })}
          </div>
        )}

        <Link
          to="/admin/customers"
          onClick={onNavigate}
          title={collapsed ? 'Customers' : undefined}
          className={navLinkClassName(
            pathname.startsWith('/admin/customers'),
            collapsed,
          )}
        >
          <Users size={17} strokeWidth={2} className="shrink-0" />
          {!collapsed && 'Customers'}
        </Link>

        <Link
          to="/admin/channels"
          onClick={onNavigate}
          title={collapsed ? 'Channels' : undefined}
          className={navLinkClassName(
            pathname.startsWith('/admin/channels'),
            collapsed,
          )}
        >
          <Plug size={17} strokeWidth={2} className="shrink-0" />
          {!collapsed && 'Channels'}
        </Link>

        <Link
          to="/admin/storefront"
          onClick={onNavigate}
          title={collapsed ? 'Storefront' : undefined}
          className={navLinkClassName(
            pathname.startsWith('/admin/storefront'),
            collapsed,
          )}
        >
          <LayoutTemplate size={17} strokeWidth={2} className="shrink-0" />
          {!collapsed && 'Storefront'}
        </Link>

        {collapsed ? (
          <div className="my-2 border-t border-neutral-100" />
        ) : (
          <p className="mt-4 mb-1 flex items-center gap-2.5 px-3 text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
            <BarChart3 size={14} strokeWidth={2} />
            Analytics
          </p>
        )}

        {ANALYTICS_SUB_LINKS.map((link) => {
          const isActive = pathname.startsWith(link.to)
          const Icon = link.icon
          return (
            <Link
              key={link.to}
              to={link.to}
              onClick={onNavigate}
              title={collapsed ? link.label : undefined}
              className={
                collapsed
                  ? navLinkClassName(isActive, true)
                  : `rounded-md px-3 py-2 text-sm font-medium ${
                      isActive
                        ? 'bg-neutral-100 text-neutral-950'
                        : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950'
                    }`
              }
            >
              {collapsed ? (
                <Icon size={17} strokeWidth={2} className="shrink-0" />
              ) : (
                link.label
              )}
            </Link>
          )
        })}

        {collapsed ? (
          <div className="my-2 border-t border-neutral-100" />
        ) : (
          <p className="mt-4 mb-1 px-3 text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
            Marketing
          </p>
        )}

        <Link
          to="/admin/discounts"
          onClick={onNavigate}
          title={collapsed ? 'Discounts' : undefined}
          className={navLinkClassName(
            pathname.startsWith('/admin/discounts'),
            collapsed,
          )}
        >
          <BadgePercent size={17} strokeWidth={2} className="shrink-0" />
          {!collapsed && 'Discounts'}
        </Link>

        <Link
          to="/admin/hide-payments"
          onClick={onNavigate}
          title={collapsed ? 'Hide Payments' : undefined}
          className={navLinkClassName(
            pathname.startsWith('/admin/hide-payments'),
            collapsed,
          )}
        >
          <EyeOff size={17} strokeWidth={2} className="shrink-0" />
          {!collapsed && 'Hide Payments'}
        </Link>

        <Link
          to="/admin/reviews"
          onClick={onNavigate}
          title={collapsed ? 'Reviews' : undefined}
          className={navLinkClassName(
            pathname.startsWith('/admin/reviews'),
            collapsed,
          )}
        >
          <Star size={17} strokeWidth={2} className="shrink-0" />
          {!collapsed && 'Reviews'}
        </Link>

        <Link
          to="/admin/email"
          onClick={onNavigate}
          title={collapsed ? 'Email' : undefined}
          className={navLinkClassName(
            pathname.startsWith('/admin/email'),
            collapsed,
          )}
        >
          <Mail size={17} strokeWidth={2} className="shrink-0" />
          {!collapsed && 'Email'}
        </Link>

        {collapsed ? (
          <div className="my-2 border-t border-neutral-100" />
        ) : (
          <p className="mt-4 mb-1 px-3 text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
            Market Development
          </p>
        )}

        <Link
          to="/admin/markets"
          onClick={onNavigate}
          title={collapsed ? 'Markets' : undefined}
          className={navLinkClassName(
            pathname.startsWith('/admin/markets'),
            collapsed,
          )}
        >
          <Globe size={17} strokeWidth={2} className="shrink-0" />
          {!collapsed && 'Markets'}
        </Link>

        {collapsed ? (
          <div className="my-2 border-t border-neutral-100" />
        ) : (
          <p className="mt-4 mb-1 px-3 text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
            Operations
          </p>
        )}

        <a
          href="https://tanstack-start-app.spades-dev.workers.dev/"
          target="_blank"
          rel="noreferrer"
          title={collapsed ? 'Shipmate' : undefined}
          className={navLinkClassName(false, collapsed)}
        >
          <Truck size={17} strokeWidth={2} className="shrink-0" />
          {!collapsed && 'Shipmate'}
        </a>
      </nav>

      <div className="border-t border-neutral-200 p-2">
        {staffRole === 'super_admin' && (
          <Link
            to="/admin/settings"
            onClick={onNavigate}
            title={collapsed ? 'Settings' : undefined}
            className={navLinkClassName(
              pathname.startsWith('/admin/settings'),
              collapsed,
            )}
          >
            <Settings size={17} strokeWidth={2} className="shrink-0" />
            {!collapsed && 'Settings'}
          </Link>
        )}
        <button
          type="button"
          onClick={handleSignOut}
          title={collapsed ? 'Sign out' : undefined}
          className={`w-full ${navLinkClassName(false, collapsed)}`}
        >
          <LogOut size={17} strokeWidth={2} className="shrink-0" />
          {!collapsed && 'Sign out'}
        </button>
      </div>
    </aside>
  )
}

import { useState } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  BadgePercent,
  ChevronDown,
  ChevronRight,
  EyeOff,
  Home,
  LogOut,
  Package,
  Plug,
  Settings,
  ShoppingBag,
  Star,
  Store,
  Users,
} from 'lucide-react'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'

const PRODUCTS_SUB_LINKS = [
  { to: '/admin/collections', label: 'Collections' },
  { to: '/admin/inventory', label: 'Inventory' },
] as const

export function AdminNav() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [expanded, setExpanded] = useState(false)

  const underProducts =
    pathname.startsWith('/admin/products') ||
    PRODUCTS_SUB_LINKS.some((link) => pathname.startsWith(link.to))
  const productsOpen = expanded || underProducts

  async function handleSignOut() {
    await getSupabaseBrowserClient().auth.signOut()
    await navigate({ to: '/admin/login' })
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <div className="px-4 py-5">
        <img src="/logo-black.png" alt="Spades" className="h-5 w-auto" />
        <p className="mt-1 text-xs text-neutral-500">Admin</p>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-2">
        <Link
          to="/admin"
          className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${
            pathname === '/admin'
              ? 'bg-neutral-100 text-neutral-950'
              : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950'
          }`}
        >
          <Home size={17} strokeWidth={2} />
          Home
        </Link>

        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950"
        >
          <Store size={17} strokeWidth={2} />
          Online Store
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
            className="flex flex-1 items-center gap-2.5 px-3 py-2 text-sm font-medium"
          >
            <Package size={17} strokeWidth={2} />
            Products
          </Link>
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
        </div>

        {productsOpen && (
          <div className="mb-1 flex flex-col gap-0.5 pl-7">
            {PRODUCTS_SUB_LINKS.map((link) => {
              const isActive = pathname.startsWith(link.to)
              return (
                <Link
                  key={link.to}
                  to={link.to}
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
          to="/admin/orders"
          className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${
            pathname.startsWith('/admin/orders')
              ? 'bg-neutral-100 text-neutral-950'
              : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950'
          }`}
        >
          <ShoppingBag size={17} strokeWidth={2} />
          Orders
        </Link>

        <Link
          to="/admin/customers"
          className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${
            pathname.startsWith('/admin/customers')
              ? 'bg-neutral-100 text-neutral-950'
              : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950'
          }`}
        >
          <Users size={17} strokeWidth={2} />
          Customers
        </Link>

        <Link
          to="/admin/channels"
          className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${
            pathname.startsWith('/admin/channels')
              ? 'bg-neutral-100 text-neutral-950'
              : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950'
          }`}
        >
          <Plug size={17} strokeWidth={2} />
          Channels
        </Link>

        <p className="mt-4 mb-1 px-3 text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
          Marketing
        </p>

        <Link
          to="/admin/discounts"
          className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${
            pathname.startsWith('/admin/discounts')
              ? 'bg-neutral-100 text-neutral-950'
              : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950'
          }`}
        >
          <BadgePercent size={17} strokeWidth={2} />
          Discounts
        </Link>

        <Link
          to="/admin/hide-payments"
          className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${
            pathname.startsWith('/admin/hide-payments')
              ? 'bg-neutral-100 text-neutral-950'
              : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950'
          }`}
        >
          <EyeOff size={17} strokeWidth={2} />
          Hide Payments
        </Link>

        <Link
          to="/admin/reviews"
          className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${
            pathname.startsWith('/admin/reviews')
              ? 'bg-neutral-100 text-neutral-950'
              : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950'
          }`}
        >
          <Star size={17} strokeWidth={2} />
          Reviews
        </Link>
      </nav>

      <div className="border-t border-neutral-200 p-2">
        <Link
          to="/admin/settings"
          className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${
            pathname.startsWith('/admin/settings')
              ? 'bg-neutral-100 text-neutral-950'
              : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950'
          }`}
        >
          <Settings size={17} strokeWidth={2} />
          Settings
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950"
        >
          <LogOut size={17} strokeWidth={2} />
          Sign out
        </button>
      </div>
    </aside>
  )
}

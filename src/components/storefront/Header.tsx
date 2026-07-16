import { Link } from '@tanstack/react-router'
import { Search, ShoppingBag, User } from 'lucide-react'
import { useCart } from '#/lib/cart/CartContext'
import { ThemeToggle } from '#/components/storefront/ThemeToggle'

const NAV_LINKS = [
  { to: '/', label: 'Home Store' },
  { to: '/about', label: 'About Us' },
  { to: '/reviews', label: 'Reviews' },
  { to: '/contact', label: 'Contact Us' },
  { to: '/collections', label: 'Shop Aspire' },
] as const

export function Header() {
  const { itemCount } = useCart()

  return (
    <header>
      <div className="bg-[#BD2100] px-4 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-white sm:text-xs">
        Free shipping minimum of &#8369;2,000 purchase. Extra 10% off minimum of
        5 items
      </div>
      <div className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center">
            <img
              src="/logo-black.png"
              alt="Spades"
              className="h-6 w-auto dark:hidden"
            />
            <img
              src="/logo-white.png"
              alt="Spades"
              className="hidden h-6 w-auto dark:block"
            />
          </Link>
          <nav className="hidden items-center gap-5 text-xs font-medium uppercase tracking-wide lg:flex lg:gap-6">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"
                activeProps={{
                  className: 'text-neutral-950 dark:text-white',
                }}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-5">
            <Link
              to="/products"
              search={{ sort: 'newest', page: 1 }}
              className="text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"
              aria-label="Search products"
            >
              <Search className="h-5 w-5" />
            </Link>
            <Link
              to="/account"
              className="text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"
              aria-label="Account"
            >
              <User className="h-5 w-5" />
            </Link>
            <Link
              to="/cart"
              className="relative text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"
              aria-label="Cart"
            >
              <ShoppingBag className="h-5 w-5" />
              {itemCount > 0 && (
                <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">
                  {itemCount}
                </span>
              )}
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  )
}

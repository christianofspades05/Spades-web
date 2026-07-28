import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Menu, Search, ShoppingBag, User, X } from 'lucide-react'
import { useCart } from '#/lib/cart/CartContext'
import { ThemeToggle } from '#/components/storefront/ThemeToggle'
import { CurrencySelector } from '#/components/storefront/CurrencySelector'
import { SearchOverlay } from '#/components/storefront/SearchOverlay'
import type { StorefrontScope } from '#/server/storefront/domain'

interface HeaderProps {
  scope: StorefrontScope
}

const NAV_LINKS = [
  { to: '/', label: 'Home Store' },
  { to: '/about', label: 'About Us' },
  { to: '/reviews', label: 'Reviews' },
  { to: '/contact', label: 'Contact Us' },
] as const

/** "Shop" should never lead to the full multi-brand catalog when locked to
 *  one brand's collection — send it to that brand's own collection page
 *  instead of the generic /collections index. */
function ShopNavLink({
  scope,
  className,
  activeClassName,
  onClick,
}: {
  scope: StorefrontScope
  className: string
  activeClassName: string
  onClick?: () => void
}) {
  if (scope.collectionSlug) {
    return (
      <Link
        to="/collections/$slug"
        params={{ slug: scope.collectionSlug }}
        onClick={onClick}
        className={className}
        activeProps={{ className: activeClassName }}
      >
        Shop Aspire
      </Link>
    )
  }
  return (
    <Link
      to="/collections"
      onClick={onClick}
      className={className}
      activeProps={{ className: activeClassName }}
    >
      Shop Aspire
    </Link>
  )
}

export function Header({ scope }: HeaderProps) {
  const { itemCount } = useCart()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  return (
    <header>
      <div className="bg-brand px-4 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-white sm:text-xs">
        {scope.promoBannerText}
      </div>
      <div className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              className="text-neutral-600 hover:text-neutral-950 lg:hidden dark:text-neutral-400 dark:hover:text-white"
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>
            <Link to="/" className="flex items-center">
              <img
                src={scope.logoLight}
                alt={scope.name}
                className="h-6 w-auto dark:hidden"
              />
              <img
                src={scope.logoDark}
                alt={scope.name}
                className="hidden h-6 w-auto dark:block"
              />
            </Link>
          </div>
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
            <ShopNavLink
              scope={scope}
              className="text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"
              activeClassName="text-neutral-950 dark:text-white"
            />
          </nav>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"
              aria-label="Search products"
            >
              <Search className="h-5 w-5" />
            </button>
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
            <CurrencySelector />
            <ThemeToggle />
          </div>
        </div>

        {mobileMenuOpen && (
          <nav className="flex flex-col gap-1 border-t border-neutral-200 px-6 py-3 text-sm font-medium uppercase tracking-wide lg:hidden dark:border-neutral-800">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-md px-2 py-2.5 text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-white"
                activeProps={{
                  className: 'text-neutral-950 dark:text-white',
                }}
              >
                {link.label}
              </Link>
            ))}
            <ShopNavLink
              scope={scope}
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-md px-2 py-2.5 text-neutral-600 hover:bg-neutral-50 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-white"
              activeClassName="text-neutral-950 dark:text-white"
            />
          </nav>
        )}
      </div>
      <SearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        collectionSlug={scope.collectionSlug}
      />
    </header>
  )
}

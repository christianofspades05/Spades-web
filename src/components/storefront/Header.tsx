import { Link } from '@tanstack/react-router'

const NAV_LINKS = [
  { to: '/collections', label: 'Collections' },
  { to: '/products', label: 'Shop' },
  { to: '/account', label: 'Account' },
] as const

export function Header() {
  return (
    <header className="border-b border-neutral-200">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="text-lg font-black tracking-tight">
          SPADES
        </Link>
        <nav className="flex gap-6 text-sm font-medium">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="text-neutral-600 hover:text-neutral-950"
              activeProps={{ className: 'text-neutral-950' }}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}

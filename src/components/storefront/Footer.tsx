import { Link } from '@tanstack/react-router'
import { Facebook, Instagram } from 'lucide-react'
import { TikTokIcon } from '#/components/storefront/TikTokIcon'

export function Footer() {
  return (
    <footer className="bg-neutral-950 text-neutral-300">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-10 px-6 py-14 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-1">
          <img src="/logo-white.png" alt="Spades" className="h-6 w-auto" />
          <p className="mt-4 max-w-xs text-sm text-neutral-400">
            Philippine streetwear for those who bet on themselves.
          </p>
          <div className="mt-5 flex items-center gap-4">
            <a
              href="https://www.facebook.com/spadesofficialph/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Facebook"
              className="text-neutral-400 hover:text-white"
            >
              <Facebook className="h-5 w-5" />
            </a>
            <a
              href="https://www.instagram.com/spades_officialph/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram"
              className="text-neutral-400 hover:text-white"
            >
              <Instagram className="h-5 w-5" />
            </a>
            <a
              href="https://www.tiktok.com/@spades_officialbrand"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="TikTok"
              className="text-neutral-400 hover:text-white"
            >
              <TikTokIcon size={20} />
            </a>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-white">
            Shop
          </h3>
          <ul className="mt-4 space-y-2 text-sm">
            <li>
              <Link
                to="/products"
                search={{ sort: 'newest', page: 1 }}
                className="hover:text-white"
              >
                All Products
              </Link>
            </li>
            <li>
              <Link to="/collections" className="hover:text-white">
                Collections
              </Link>
            </li>
            <li>
              <Link to="/cart" className="hover:text-white">
                Cart
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-white">
            Help
          </h3>
          <ul className="mt-4 space-y-2 text-sm">
            <li>
              <Link to="/account" className="hover:text-white">
                Account
              </Link>
            </li>
            <li className="text-neutral-500">Shipping &amp; Returns</li>
            <li>
              <Link to="/contact" className="hover:text-white">
                Contact Us
              </Link>
            </li>
          </ul>
        </div>

        <div className="col-span-2 sm:col-span-1">
          <h3 className="text-xs font-bold uppercase tracking-wider text-white">
            Stay Updated
          </h3>
          <p className="mt-4 text-sm text-neutral-400">
            Get first access to new drops and restocks.
          </p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => e.preventDefault()}
          >
            <input
              type="email"
              required
              placeholder="Email address"
              className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-white focus:outline-none"
            />
            <button
              type="submit"
              className="shrink-0 rounded-md bg-white px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200"
            >
              Join
            </button>
          </form>
        </div>
      </div>

      <div className="border-t border-neutral-800 px-6 py-5 text-center text-xs text-neutral-500">
        © {new Date().getFullYear()} Spades. All rights reserved.
      </div>
    </footer>
  )
}

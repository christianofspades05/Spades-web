import { Link } from '@tanstack/react-router'
import { Facebook, Instagram } from 'lucide-react'
import { TikTokIcon } from '#/components/storefront/TikTokIcon'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import type { StorefrontScope } from '#/server/storefront/domain'

interface FooterProps {
  scope: StorefrontScope
}

function CollectionOrCatalogLink({
  scope,
  label,
}: {
  scope: StorefrontScope
  label: string
}) {
  if (scope.collectionSlug) {
    return (
      <Link
        to="/collections/$slug"
        params={{ slug: scope.collectionSlug }}
        className="hover:text-white"
      >
        {label}
      </Link>
    )
  }
  return (
    <Link to="/collections" className="hover:text-white">
      {label}
    </Link>
  )
}

export function Footer({ scope }: FooterProps) {
  const { t, language } = useLanguage()
  const tagline =
    (language === 'ja'
      ? scope.taglineJa
      : language === 'ko'
        ? scope.taglineKo
        : null) || scope.tagline
  return (
    <footer className="bg-neutral-950 text-neutral-300">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-10 px-6 py-14 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-1">
          <img src={scope.logoDark} alt={scope.name} className="h-6 w-auto" />
          {tagline && (
            <p className="mt-4 max-w-xs text-sm text-neutral-400">
              {tagline}
            </p>
          )}
          <div className="mt-5 flex items-center gap-4">
            {scope.social.facebook && (
              <a
                href={scope.social.facebook}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Facebook"
                className="text-neutral-400 hover:text-white"
              >
                <Facebook className="h-5 w-5" />
              </a>
            )}
            {scope.social.instagram && (
              <a
                href={scope.social.instagram}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram"
                className="text-neutral-400 hover:text-white"
              >
                <Instagram className="h-5 w-5" />
              </a>
            )}
            {scope.social.tiktok && (
              <a
                href={scope.social.tiktok}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="TikTok"
                className="text-neutral-400 hover:text-white"
              >
                <TikTokIcon size={20} />
              </a>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-white">
            {t.footer.shopHeading}
          </h3>
          <ul className="mt-4 space-y-2 text-sm">
            <li>
              {scope.collectionSlug ? (
                <CollectionOrCatalogLink
                  scope={scope}
                  label={t.footer.allProducts}
                />
              ) : (
                <Link
                  to="/products"
                  search={{ sort: 'stock_desc', page: 1 }}
                  className="hover:text-white"
                >
                  {t.footer.allProducts}
                </Link>
              )}
            </li>
            <li>
              <CollectionOrCatalogLink
                scope={scope}
                label={t.footer.collections}
              />
            </li>
            <li>
              <Link to="/cart" className="hover:text-white">
                {t.footer.cart}
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-white">
            {t.footer.helpHeading}
          </h3>
          <ul className="mt-4 space-y-2 text-sm">
            <li>
              <Link to="/account" className="hover:text-white">
                {t.footer.account}
              </Link>
            </li>
            <li className="text-neutral-500">
              {t.footer.shippingAndReturns}
            </li>
            <li>
              <Link to="/contact" className="hover:text-white">
                {t.footer.contactUs}
              </Link>
            </li>
          </ul>
        </div>

        <div className="col-span-2 sm:col-span-1">
          <h3 className="text-xs font-bold uppercase tracking-wider text-white">
            {t.footer.stayUpdatedHeading}
          </h3>
          <p className="mt-4 text-sm text-neutral-400">
            {t.footer.stayUpdatedBody}
          </p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => e.preventDefault()}
          >
            <input
              type="email"
              required
              placeholder={t.footer.emailPlaceholder}
              className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-white focus:outline-none"
            />
            <button
              type="submit"
              className="shrink-0 rounded-md bg-white px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200"
            >
              {t.footer.join}
            </button>
          </form>
        </div>
      </div>

      <div className="border-t border-neutral-800 px-6 py-5 text-center text-xs text-neutral-500">
        © {new Date().getFullYear()} {scope.name}. {t.footer.rightsReserved}
      </div>
    </footer>
  )
}

import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
  useRouterState,
} from '@tanstack/react-router'

import { Header } from '#/components/storefront/Header'
import { Footer } from '#/components/storefront/Footer'
import { MaintenancePage } from '#/components/storefront/MaintenancePage'
import { LanguagePopup } from '#/components/storefront/LanguagePopup'
import { EmailCapturePopup } from '#/components/storefront/EmailCapturePopup'
import { VisitTracker } from '#/components/storefront/VisitTracker'
import { LiveViewerHeartbeat } from '#/components/storefront/LiveViewerHeartbeat'
import { FacebookPixelPageView } from '#/components/storefront/FacebookPixel'
import { buildPixelBootstrapScript } from '#/lib/analytics/facebook-pixel'
import { CartProvider } from '#/lib/cart/CartContext'
import { ThemeProvider } from '#/lib/theme/ThemeProvider'
import { CurrencyProvider } from '#/lib/currency/CurrencyContext'
import { LanguageProvider } from '#/lib/i18n/LanguageContext'
import { getRootLoaderData } from '#/server/storefront/root-loader'
import appCss from '../styles.css?url'

/**
 * Runs before hydration so a returning visitor never sees a flash of the
 * wrong theme. Sets the class directly via the DOM (not React state) —
 * ThemeProvider's own state starts at 'light' on both server and client to
 * keep hydration consistent, then syncs to match whatever this already set.
 * An explicit stored preference always wins; otherwise falls back to the
 * current brand's own default (see StorefrontScope.defaultTheme) — e.g.
 * Aspire 365 defaults to dark for a first-time visitor.
 */
function buildNoFlashThemeScript(defaultTheme: 'light' | 'dark'): string {
  const fallback =
    defaultTheme === 'dark'
      ? "document.documentElement.classList.add('dark')"
      : ''
  return `try{var t=localStorage.getItem('theme');if(t==='dark'){document.documentElement.classList.add('dark')}else if(t!=='light'){${fallback}}}catch(e){}`
}

export const Route = createRootRoute({
  // Without this, both an unmatched path (e.g. a bot probing pre-migration
  // Shopify-era URLs like /products.json or /cart.js) and an explicit
  // `throw notFound()` from any route's loader (11 of them across storefront
  // and admin — see products/$slug.tsx, admin/orders/$orderId.tsx, etc.)
  // have nowhere to render, which crashes the SSR render as an unhandled
  // error and surfaces as a raw 500 instead of a clean 404 — confirmed live
  // via Vercel's runtime logs, ~1,000 of these over 7 days, almost all bots
  // hitting old Shopify-convention endpoints that don't exist in this app.
  notFoundComponent: NotFoundComponent,
  // A single createServerFn call instead of 7 separate ones (see
  // server/storefront/root-loader.ts for why that's a real reduction in
  // Vercel requests, not just code shape, and for the individual-fallback
  // behavior this preserves unchanged).
  beforeLoad: () => getRootLoaderData(),
  head: ({ match }) => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: match.context.storefrontScope.title,
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'icon',
        type: 'image/png',
        href: match.context.storefrontScope.faviconUrl,
      },
      // Spades has dedicated, properly-sized icon assets; Ysrael/Aspire 365
      // fall back to their logo file (see StorefrontScope.faviconUrl) until
      // they get their own square favicon/apple-touch-icon.
      ...(match.context.storefrontScope.brand === 'spades'
        ? [
            { rel: 'icon', href: '/favicon.ico' },
            {
              rel: 'apple-touch-icon',
              sizes: '180x180',
              href: '/apple-touch-icon.png',
            },
          ]
        : [
            {
              rel: 'apple-touch-icon',
              href: match.context.storefrontScope.faviconUrl,
            },
          ]),
      {
        rel: 'manifest',
        href: '/manifest.json',
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isAdminRoute = pathname.startsWith('/admin')
  const {
    geoDefaultCurrency,
    geoCountry,
    storefrontScope,
    maintenanceMode,
    banner,
    emailCapturePopupEnabled,
  } = Route.useRouteContext()
  const showMaintenance = !isAdminRoute && maintenanceMode
  const pixelBootstrapScript = buildPixelBootstrapScript(
    storefrontScope.fbPixelId,
  )
  // Admin is the one shared control panel across all three brands' domains
  // — it always stays Spades-branded, so the accent-color override below
  // (and the rest of storefrontScope) only applies to non-admin routes.
  const priceTextVars = storefrontScope.priceTextHex
    ? `--price-text-light:${storefrontScope.priceTextHex};--price-text-dark:${storefrontScope.priceTextDarkHex};`
    : ''
  const brandColorStyle = `:root{--color-brand:${storefrontScope.colorHex};--color-brand-dark:${storefrontScope.colorDarkHex};${priceTextVars}}`
  const noFlashThemeScript = buildNoFlashThemeScript(
    storefrontScope.defaultTheme,
  )

  return (
    <html lang="en">
      <head>
        {!isAdminRoute && (
          <script dangerouslySetInnerHTML={{ __html: noFlashThemeScript }} />
        )}
        {!isAdminRoute && (
          <style dangerouslySetInnerHTML={{ __html: brandColorStyle }} />
        )}
        {!isAdminRoute && pixelBootstrapScript && (
          <script dangerouslySetInnerHTML={{ __html: pixelBootstrapScript }} />
        )}
        <HeadContent />
      </head>
      <body>
        {!isAdminRoute && storefrontScope.fbPixelId && (
          <noscript>
            <img
              height="1"
              width="1"
              alt=""
              style={{ display: 'none' }}
              src={`https://www.facebook.com/tr?id=${storefrontScope.fbPixelId}&ev=PageView&noscript=1`}
            />
          </noscript>
        )}
        <VisitTracker brand={storefrontScope.brand} />
        <LiveViewerHeartbeat brand={storefrontScope.brand} />
        <FacebookPixelPageView />
        <ThemeProvider defaultTheme={storefrontScope.defaultTheme}>
          <LanguageProvider geoCountry={geoCountry}>
            <CurrencyProvider
              geoDefaultCurrency={geoDefaultCurrency}
              geoCountry={geoCountry}
            >
              <CartProvider>
                {showMaintenance ? (
                  <MaintenancePage scope={storefrontScope} />
                ) : (
                  <>
                    {!isAdminRoute && (
                      <Header scope={storefrontScope} banner={banner} />
                    )}
                    {children}
                    {!isAdminRoute && <Footer scope={storefrontScope} />}
                    {!isAdminRoute && <LanguagePopup />}
                    {!isAdminRoute && (
                      <EmailCapturePopup enabled={emailCapturePopupEnabled} />
                    )}
                  </>
                )}
              </CartProvider>
            </CurrencyProvider>
          </LanguageProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}

/** Renders inside RootDocument's `{children}` slot (see above) — the
 *  storefront Header/Footer or admin chrome around it still render
 *  normally, only the page body differs. */
function NotFoundComponent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isAdminRoute = pathname.startsWith('/admin')
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">
        Page not found
      </h1>
      <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
        The page you're looking for doesn't exist or may have been moved.
      </p>
      <Link
        to={isAdminRoute ? '/admin' : '/'}
        className="mt-6 inline-flex items-center justify-center rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
      >
        {isAdminRoute ? 'Back to admin' : 'Back to homepage'}
      </Link>
    </div>
  )
}

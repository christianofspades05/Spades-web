import {
  HeadContent,
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
import { getGeoCountry, getGeoDefaultCurrency } from '#/server/currency/geo'
import { getStorefrontScope } from '#/server/storefront/domain'
import { getMaintenanceMode } from '#/server/storefront/maintenance'
import { getStorefrontBanner } from '#/server/storefront/banner'
import { getEmailCapturePopupEnabled } from '#/server/storefront/email-capture'
import { withTimeout } from '#/lib/utils/timeout'
import appCss from '../styles.css?url'

/** A Supabase/Cloudflare edge blip can hang far longer than it's worth
 *  waiting on a best-effort, already-has-a-fallback value for — see
 *  withTimeout's doc comment. */
const BEFORE_LOAD_IO_TIMEOUT_MS = 3000

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
  beforeLoad: async () => {
    // storefrontScope resolves synchronously from the request's Host
    // header (no I/O — see server/storefront/domain.ts), so it's awaited
    // first to know which brand's maintenance flag to check, then the rest
    // run in parallel as before.
    const storefrontScope = await getStorefrontScope()
    // Every one of these is caught individually with a safe fallback rather
    // than left to reject the whole Promise.all, which would throw
    // beforeLoad itself and 500 every route on this app for every visitor
    // over what's otherwise just a cosmetic/best-effort feature. A
    // transient Supabase (or Vercel geo-header) blip should degrade these,
    // not take down the entire site — this is what actually happened during
    // the 2026-08-03 ~11:20pm PST incident (Supabase-side connectivity
    // issues briefly 500'd the homepage before geoCountry/geoDefaultCurrency
    // were wrapped the same way banner/maintenance already were).
    const [
      geoDefaultCurrency,
      geoCountry,
      maintenanceMode,
      banner,
      emailCapturePopupEnabled,
    ] = await Promise.all([
      getGeoDefaultCurrency().catch((err: unknown) => {
        console.error('getGeoDefaultCurrency failed:', err)
        return null
      }),
      getGeoCountry().catch((err: unknown) => {
        console.error('getGeoCountry failed:', err)
        return null
      }),
      withTimeout(
        getMaintenanceMode({ data: { brand: storefrontScope.brand } }),
        BEFORE_LOAD_IO_TIMEOUT_MS,
      ).catch((err: unknown) => {
        console.error('getMaintenanceMode failed:', err)
        return false
      }),
      withTimeout(
        getStorefrontBanner({ data: { brand: storefrontScope.brand } }),
        BEFORE_LOAD_IO_TIMEOUT_MS,
      ).catch((err: unknown) => {
        console.error('getStorefrontBanner failed:', err)
        return { text: '', textJa: null, textKo: null, isActive: false }
      }),
      withTimeout(
        getEmailCapturePopupEnabled(),
        BEFORE_LOAD_IO_TIMEOUT_MS,
      ).catch((err: unknown) => {
        console.error('getEmailCapturePopupEnabled failed:', err)
        return false
      }),
    ])
    return {
      geoDefaultCurrency,
      geoCountry,
      storefrontScope,
      maintenanceMode,
      banner,
      emailCapturePopupEnabled,
    }
  },
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

import {
  HeadContent,
  Scripts,
  createRootRoute,
  useRouterState,
} from '@tanstack/react-router'

import { Header } from '#/components/storefront/Header'
import { Footer } from '#/components/storefront/Footer'
import { VisitTracker } from '#/components/storefront/VisitTracker'
import { FacebookPixelPageView } from '#/components/storefront/FacebookPixel'
import { buildPixelBootstrapScript } from '#/lib/analytics/facebook-pixel'
import { CartProvider } from '#/lib/cart/CartContext'
import { ThemeProvider } from '#/lib/theme/ThemeProvider'
import { CurrencyProvider } from '#/lib/currency/CurrencyContext'
import { getGeoCountry, getGeoDefaultCurrency } from '#/server/currency/geo'
import { getStorefrontScope } from '#/server/storefront/domain'
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
  beforeLoad: async () => {
    const [geoDefaultCurrency, geoCountry, storefrontScope] = await Promise.all(
      [getGeoDefaultCurrency(), getGeoCountry(), getStorefrontScope()],
    )
    return { geoDefaultCurrency, geoCountry, storefrontScope }
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
  const { geoDefaultCurrency, geoCountry, storefrontScope } =
    Route.useRouteContext()
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
        <FacebookPixelPageView />
        <ThemeProvider defaultTheme={storefrontScope.defaultTheme}>
          <CurrencyProvider
            geoDefaultCurrency={geoDefaultCurrency}
            geoCountry={geoCountry}
          >
            <CartProvider>
              {!isAdminRoute && <Header scope={storefrontScope} />}
              {children}
              {!isAdminRoute && <Footer scope={storefrontScope} />}
            </CartProvider>
          </CurrencyProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}

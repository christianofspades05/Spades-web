/**
 * Best-effort default display currency based on the visitor's country, read
 * from Vercel's edge-populated `x-vercel-ip-country` request header (absent
 * in local dev — falls back to null, which CurrencyProvider treats as "stay
 * on PHP"). Only ever used as the *initial* default when the visitor has no
 * stored currency preference yet — see CurrencyContext.tsx.
 */
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getRequestHeader, getRequestUrl } from '@tanstack/react-start/server'
import type { Currency } from '#/lib/utils/money'

const COUNTRY_TO_CURRENCY: Record<string, Currency> = {
  US: 'USD',
  GB: 'GBP',
  SG: 'SGD',
  MY: 'MYR',
  TH: 'THB',
  VN: 'VND',
  HK: 'HKD',
  JP: 'JPY',
  MO: 'MOP',
  KR: 'KRW',
  TW: 'TWD',
  // Eurozone (21 members — the 20 prior members plus Bulgaria, which
  // adopted the euro on 2026-01-01).
  AT: 'EUR',
  BE: 'EUR',
  BG: 'EUR',
  CY: 'EUR',
  DE: 'EUR',
  EE: 'EUR',
  ES: 'EUR',
  FI: 'EUR',
  FR: 'EUR',
  GR: 'EUR',
  HR: 'EUR',
  IE: 'EUR',
  IT: 'EUR',
  LT: 'EUR',
  LU: 'EUR',
  LV: 'EUR',
  MT: 'EUR',
  NL: 'EUR',
  PT: 'EUR',
  SI: 'EUR',
  SK: 'EUR',
  // Not Eurozone/EU members, but the euro is their real circulating
  // currency (by formal monetary agreement for AD/MC/SM/VA, adopted
  // unilaterally by ME/XK) — a visitor from any of these should still see
  // EUR pricing, not fall through to PHP.
  AD: 'EUR',
  MC: 'EUR',
  SM: 'EUR',
  VA: 'EUR',
  ME: 'EUR',
  XK: 'EUR',
}

/**
 * Real header in production; in local dev (no real IP to geolocate),
 * ?__geoCountry=SG on any page simulates one — shared by both functions
 * below so a single query param gives a complete, realistic local preview
 * (currency default AND market markup switch together, matching what a
 * real Singapore visitor would see in production). Never active outside
 * `vite dev` (import.meta.env.DEV is false in any real build, including
 * Vercel preview deployments) — same reasoning as domain.ts's ?__brand=.
 */
/**
 * Exported (not just a private helper) so server/storefront/root-loader.ts
 * can call it directly rather than through the getGeoCountry createServerFn
 * below — see domain.ts's checkNonCanonicalVercelHostRedirect doc comment
 * for the full reasoning on createServerOnlyFn here (a nested createServerFn
 * call isn't reliably resolved in-process by the production build, and a
 * plain function using a server-only import needs this wrapper or the
 * build's import-protection plugin correctly refuses to bundle it).
 */
export const resolveGeoCountry = createServerOnlyFn((): string | null => {
  if (import.meta.env.DEV) {
    const debugCountry = getRequestUrl().searchParams.get('__geoCountry')
    if (debugCountry) return debugCountry.toUpperCase()
  }
  return getRequestHeader('x-vercel-ip-country') ?? null
})

export function resolveGeoDefaultCurrency(): Currency | null {
  const country = resolveGeoCountry()
  if (!country) return null
  return COUNTRY_TO_CURRENCY[country] ?? null
}

/**
 * LEGACY COMPATIBILITY ENDPOINT — see getMaintenanceMode's identical doc
 * comment in server/storefront/maintenance.ts. Not called from anywhere
 * in this codebase anymore; kept only so a stale cached HTML/JS bundle
 * from before root-loader.ts switched to resolveGeoDefaultCurrency
 * doesn't hit a hard 404/500 for the few minutes it can still be served.
 * Revisit deleting once several deployments pass without that error
 * recurring.
 */
export const getGeoDefaultCurrency = createServerFn({ method: 'GET' }).handler(
  (): Currency | null => resolveGeoDefaultCurrency(),
)

/**
 * Raw ISO country code (e.g. "SG"), not mapped to a currency — used to
 * best-effort apply a country's product-price markup (see
 * lib/checkout/market-pricing.ts) while browsing, before the visitor has
 * chosen a shipping destination at checkout.
 *
 * LEGACY COMPATIBILITY ENDPOINT — same reasoning as getGeoDefaultCurrency
 * just above (not called anywhere anymore; kept only for stale-bundle
 * compatibility during a deploy transition).
 */
export const getGeoCountry = createServerFn({ method: 'GET' }).handler(
  (): string | null => resolveGeoCountry(),
)

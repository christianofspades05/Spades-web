/**
 * Everything __root.tsx's beforeLoad needs, gathered behind a single
 * createServerFn call instead of the 7 separate ones this used to be
 * (redirectNonCanonicalVercelHost, getStorefrontScope, getGeoDefaultCurrency,
 * getGeoCountry, getMaintenanceMode, getStorefrontBanner,
 * getEmailCapturePopupEnabled — see those files for what each still does on
 * its own, unchanged; they're still called independently elsewhere, e.g.
 * checkout code calling getStorefrontScope directly).
 *
 * Why this actually reduces Vercel usage, not just code shape: a
 * createServerFn's handler only ever executes server-side, so calling
 * another createServerFn *from inside* one (as this does with all 7 below)
 * resolves in-process — no extra network hop, no extra Function Invocation
 * — the same pattern server/checkout/place-order.ts already relies on by
 * calling getStorefrontScope() directly. The 7-separate-calls version only
 * gets that in-process benefit for the very first (SSR) page load of a
 * session; every later client-side navigation re-runs beforeLoad *in the
 * browser*, where each of those 7 calls is a real fetch() to the server —
 * confirmed live in Vercel's runtime logs, where all 7 logged within ~2% of
 * each other's request count (a cost audit's top finding: ~65% of measured
 * request volume). Collapsing them into one createServerFn means every
 * navigation now costs 1 request here instead of 7, in both the SSR and
 * client-navigation case alike.
 */
import { createServerFn } from '@tanstack/react-start'
import { withTimeout } from '#/lib/utils/timeout'
import {
  getStorefrontScope,
  redirectNonCanonicalVercelHost,
} from '#/server/storefront/domain'
import type { StorefrontScope } from '#/server/storefront/domain'
import { getGeoCountry, getGeoDefaultCurrency } from '#/server/currency/geo'
import { getMaintenanceMode } from '#/server/storefront/maintenance'
import { getStorefrontBanner } from '#/server/storefront/banner'
import type { StorefrontBannerMessage } from '#/server/storefront/banner'
import { getEmailCapturePopupEnabled } from '#/server/storefront/email-capture'
import type { Currency } from '#/lib/utils/money'

const BEFORE_LOAD_IO_TIMEOUT_MS = 6000

export interface RootLoaderData {
  geoDefaultCurrency: Currency | null
  geoCountry: string | null
  storefrontScope: StorefrontScope
  maintenanceMode: boolean
  banner: StorefrontBannerMessage[]
  emailCapturePopupEnabled: boolean
}

export const getRootLoaderData = createServerFn({ method: 'GET' }).handler(
  async (): Promise<RootLoaderData> => {
    // See redirectNonCanonicalVercelHost's doc comment — bounces a visitor
    // away from Vercel's own *.vercel.app hosts before anything else runs.
    await redirectNonCanonicalVercelHost()

    // storefrontScope resolves synchronously from the request's Host
    // header (no I/O — see server/storefront/domain.ts), so it's awaited
    // first to know which brand's maintenance flag to check, then the rest
    // run in parallel as before.
    const storefrontScope = await getStorefrontScope()

    // Every one of these is caught individually with a safe fallback rather
    // than left to reject the whole Promise.all, which would throw this
    // handler itself and 500 every route on this app for every visitor over
    // what's otherwise just a cosmetic/best-effort feature. A transient
    // Supabase (or Vercel geo-header) blip should degrade these, not take
    // down the entire site — this is what actually happened during the
    // 2026-08-03 ~11:20pm PST incident (Supabase-side connectivity issues
    // briefly 500'd the homepage before geoCountry/geoDefaultCurrency were
    // wrapped the same way banner/maintenance already were).
    const [geoDefaultCurrency, geoCountry, maintenanceMode, banner, emailCapturePopupEnabled] =
      await Promise.all([
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
          return []
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
)

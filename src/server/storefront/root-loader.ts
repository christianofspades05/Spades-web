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
 * createServerFn's handler only ever executes server-side, so in principle
 * calling another createServerFn *from inside* one should resolve
 * in-process — no extra network hop, no extra Function Invocation. In
 * practice, on the production Vercel/Nitro build specifically, that only
 * held for functions still called *directly from a route file* elsewhere
 * (getStorefrontScope, kept alive by place-order.ts/lalamove.ts calling it
 * directly) — the other 5 stopped being reachable through TanStack Start's
 * build-time server-function registry the moment __root.tsx stopped
 * calling them directly, and started throwing "Server function info not
 * found" on every call here (caught by each individual .catch() below,
 * degrading silently rather than crashing — but real functionality: geo
 * currency, maintenance mode, and the promo banner were all silently
 * broken for a period after the first version of this file shipped).
 * Confirmed live in Vercel's runtime logs and fixed by calling each
 * function's plain (non-createServerFn) implementation directly instead —
 * see resolveGeoCountry, resolveMaintenanceMode, resolveStorefrontBanner,
 * resolveEmailCapturePopupEnabled, resolveStorefrontScope,
 * checkNonCanonicalVercelHostRedirect in their respective files. This
 * sidesteps the registry entirely rather than depending on framework
 * internals that turned out not to work the way local `vite dev` testing
 * suggested.
 *
 * The original request-volume win is unchanged: every navigation now
 * costs 1 request here instead of the 7 separate ones this replaced —
 * confirmed live in Vercel's runtime logs, where all 7 logged within ~2%
 * of each other's request count (a cost audit's top finding: ~65% of
 * measured request volume).
 */
import { createServerFn } from '@tanstack/react-start'
import { withTimeout } from '#/lib/utils/timeout'
import {
  checkNonCanonicalVercelHostRedirect,
  resolveStorefrontScope,
} from '#/server/storefront/domain'
import type { StorefrontScope } from '#/server/storefront/domain'
import { resolveGeoCountry, resolveGeoDefaultCurrency } from '#/server/currency/geo'
import { resolveMaintenanceMode } from '#/server/storefront/maintenance'
import { resolveStorefrontBanner } from '#/server/storefront/banner'
import type { StorefrontBannerMessage } from '#/server/storefront/banner'
import { resolveEmailCapturePopupEnabled } from '#/server/storefront/email-capture'
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
    // See checkNonCanonicalVercelHostRedirect's doc comment — bounces a
    // visitor away from Vercel's own *.vercel.app hosts before anything
    // else runs.
    checkNonCanonicalVercelHostRedirect()

    // storefrontScope resolves synchronously from the request's Host
    // header (no I/O — see server/storefront/domain.ts), so it's resolved
    // first to know which brand's maintenance flag to check, then the rest
    // run in parallel as before.
    const storefrontScope = resolveStorefrontScope()

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
        Promise.resolve(resolveGeoDefaultCurrency()).catch((err: unknown) => {
          console.error('getGeoDefaultCurrency failed:', err)
          return null
        }),
        Promise.resolve(resolveGeoCountry()).catch((err: unknown) => {
          console.error('getGeoCountry failed:', err)
          return null
        }),
        withTimeout(
          resolveMaintenanceMode(storefrontScope.brand),
          BEFORE_LOAD_IO_TIMEOUT_MS,
        ).catch((err: unknown) => {
          console.error('getMaintenanceMode failed:', err)
          return false
        }),
        withTimeout(
          resolveStorefrontBanner(storefrontScope.brand),
          BEFORE_LOAD_IO_TIMEOUT_MS,
        ).catch((err: unknown) => {
          console.error('getStorefrontBanner failed:', err)
          return []
        }),
        withTimeout(
          resolveEmailCapturePopupEnabled(),
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

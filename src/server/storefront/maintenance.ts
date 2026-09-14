import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSupabaseServerClient } from '#/lib/supabase/server'
import { STOREFRONT_BRANDS } from '#/lib/validation/admin/storefront-sections'
import { createSharedCache } from '#/lib/utils/shared-cache'

type Brand = (typeof STOREFRONT_BRANDS)[number]

function maintenanceModeCacheKey(brand: Brand): string {
  return `storefront-maintenance:${brand}`
}

// Checked on every single storefront page load (see routes/__root.tsx's
// beforeLoad, via root-loader.ts) but almost never actually changes —
// caching it briefly turns "one DB round trip per page view, site-wide"
// into "one DB round trip per TTL window, shared across every warm
// instance." Was createPromiseCache (process-local, 30s): the same gap
// already fixed for markets/collections/discounts — every warm Fluid/
// Lambda instance kept its own independent copy instead of sharing one
// site-wide. Switched to createSharedCache (Vercel Runtime Cache +
// single-flight), 300s TTL — safe because setMaintenanceMode (the only
// write path, in server/admin/maintenance.ts) calls
// invalidateMaintenanceModeCache(brand) immediately after a successful
// write, so an admin toggle is visible right away instead of waiting out
// the TTL. Keyed and tagged per brand (storefront-maintenance:<brand>) so
// Spades/Ysrael/Aspire365 never share an entry — each is its own row in
// storefront_maintenance_mode.
const MAINTENANCE_MODE_CACHE_TTL_SECONDS = 300
const maintenanceModeCache = createSharedCache<boolean>(
  MAINTENANCE_MODE_CACHE_TTL_SECONDS,
)

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

/** Invalidates one brand's cached maintenance flag — called by
 *  setMaintenanceMode (server/admin/maintenance.ts) immediately after a
 *  successful write. Fail-open, same as the cache itself: never throws,
 *  since the write it's cleaning up after has already succeeded. */
export function invalidateMaintenanceModeCache(brand: Brand): Promise<void> {
  return maintenanceModeCache.invalidate([maintenanceModeCacheKey(brand)])
}

/**
 * Whether `brand`'s storefront should currently show the maintenance page
 * instead of its normal site — checked on every page load from
 * routes/__root.tsx (see beforeLoad, via root-loader.ts). Public/anon
 * read, same as exchange_rates — there's nothing sensitive in a
 * maintenance flag.
 *
 * Wrapped in createServerOnlyFn, not just a plain function — see
 * domain.ts's checkNonCanonicalVercelHostRedirect doc comment for the full
 * reasoning (a nested createServerFn call isn't reliably resolved
 * in-process by the production build, and a plain function touching a
 * server-only import, even transitively via getSupabaseServerClient,
 * needs this wrapper or the build's import-protection plugin correctly
 * refuses to bundle it into any client-rendered page that imports this
 * file).
 */
export const resolveMaintenanceMode = createServerOnlyFn(
  async (brand: Brand): Promise<boolean> => {
    return maintenanceModeCache.get(
      maintenanceModeCacheKey(brand),
      async () => {
        const supabase = getSupabaseServerClient()
        const { data: row, error } = await supabase
          .from('storefront_maintenance_mode')
          .select('is_active')
          .eq('brand', brand)
          .maybeSingle()
        if (error) throw error
        return row?.is_active ?? false
      },
      { tags: [maintenanceModeCacheKey(brand)], isValid: isBoolean },
    )
  },
)

/**
 * LEGACY COMPATIBILITY ENDPOINT — not called from anywhere in this
 * codebase anymore (root-loader.ts calls resolveMaintenanceMode directly
 * instead, see that file's history). Kept, not deleted, deliberately: a
 * browser holding a stale cached HTML/JS bundle from before that switch
 * (possible for a few minutes after any deploy — STOREFRONT_CACHE_HEADERS'
 * stale-while-revalidate window) still references this exact endpoint by
 * its build hash, and removing it would turn "briefly served the previous
 * deployment's page" into a broken request instead of a working one.
 * Revisit deleting this once several deployments have passed with no
 * recurrence of the "Server function info not found" 5xx pattern this
 * caused right after root-loader.ts stopped calling it directly.
 */
export const getMaintenanceMode = createServerFn({ method: 'GET' })
  .validator(z.object({ brand: z.enum(STOREFRONT_BRANDS) }))
  .handler(async ({ data }): Promise<boolean> => resolveMaintenanceMode(data.brand))

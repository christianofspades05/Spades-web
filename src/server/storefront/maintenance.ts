import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSupabaseServerClient } from '#/lib/supabase/server'
import { STOREFRONT_BRANDS } from '#/lib/validation/admin/storefront-sections'
import { createPromiseCache } from '#/lib/utils/cache'

// Checked on every single storefront page load (see routes/__root.tsx's
// beforeLoad) but almost never actually changes — caching it briefly turns
// "one DB round trip per page view, site-wide" into "one DB round trip per
// 15s, shared across however many visitors load a page in that window."
// See createPromiseCache's doc comment for why this caches the promise, not
// just the resolved value.
const MAINTENANCE_MODE_CACHE_TTL_MS = 30_000
const maintenanceModeCache = createPromiseCache<boolean>(
  MAINTENANCE_MODE_CACHE_TTL_MS,
)

/**
 * Whether `brand`'s storefront should currently show the maintenance page
 * instead of its normal site — checked on every page load from
 * routes/__root.tsx (see beforeLoad). Public/anon read, same as
 * exchange_rates — there's nothing sensitive in a maintenance flag.
 */
export const getMaintenanceMode = createServerFn({ method: 'GET' })
  .validator(z.object({ brand: z.enum(STOREFRONT_BRANDS) }))
  .handler(async ({ data }): Promise<boolean> => {
    return maintenanceModeCache.get(data.brand, async () => {
      const supabase = getSupabaseServerClient()
      const { data: row, error } = await supabase
        .from('storefront_maintenance_mode')
        .select('is_active')
        .eq('brand', data.brand)
        .maybeSingle()
      if (error) throw error
      return row?.is_active ?? false
    })
  })

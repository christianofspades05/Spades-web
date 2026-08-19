import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSupabaseServerClient } from '#/lib/supabase/server'
import { STOREFRONT_BRANDS } from '#/lib/validation/admin/storefront-sections'
import { createPromiseCache } from '#/lib/utils/cache'

export interface StorefrontBannerMessage {
  text: string
  textJa: string | null
  textKo: string | null
}

// Same rationale as maintenance.ts's cache — checked on every page load,
// rarely changes.
const BANNER_CACHE_TTL_MS = 30_000
const bannerCache = createPromiseCache<StorefrontBannerMessage[]>(
  BANNER_CACHE_TTL_MS,
)

/**
 * `brand`'s top promo banners, in rotation order — checked on every page
 * load from routes/__root.tsx (see beforeLoad, via root-loader.ts), same
 * pattern as getMaintenanceMode. Public/anon read — there's nothing
 * sensitive in a promo banner. Only active rows are returned; an empty
 * array means "show nothing," same as the old single-banner isActive:
 * false.
 *
 * Wrapped in createServerOnlyFn, not just a plain function — see
 * domain.ts's checkNonCanonicalVercelHostRedirect doc comment for the full
 * reasoning.
 */
export const resolveStorefrontBanner = createServerOnlyFn(
  async (
    brand: (typeof STOREFRONT_BRANDS)[number],
  ): Promise<StorefrontBannerMessage[]> => {
    return bannerCache.get(brand, async () => {
      const supabase = getSupabaseServerClient()
      const { data: rows, error } = await supabase
        .from('storefront_banner')
        .select('text, text_ja, text_ko')
        .eq('brand', brand)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
      if (error) throw error
      return rows.map((row) => ({
        text: row.text,
        textJa: row.text_ja,
        textKo: row.text_ko,
      }))
    })
  },
)

export const getStorefrontBanner = createServerFn({ method: 'GET' })
  .validator(z.object({ brand: z.enum(STOREFRONT_BRANDS) }))
  .handler(
    async ({ data }): Promise<StorefrontBannerMessage[]> =>
      resolveStorefrontBanner(data.brand),
  )

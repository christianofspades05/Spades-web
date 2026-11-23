import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '#/lib/supabase/server'
import { createSharedCache } from '#/lib/utils/shared-cache'

export interface StorefrontCommunityFit {
  id: string
  instagramUrl: string
  imageUrl: string
  handle: string
}

const COMMUNITY_FITS_CACHE_KEY = 'storefront-community-fits'
// Same shared-cache + explicit-invalidation approach as storefront
// sections (see sections.ts): read on every Spades homepage load, only ever
// changed by an admin edit, and every admin write in
// server/admin/community-fits.ts calls invalidateCommunityFitsCache().
const communityFitsCache = createSharedCache<StorefrontCommunityFit[]>(300)

function isCommunityFitArray(
  value: unknown,
): value is StorefrontCommunityFit[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) =>
        typeof v === 'object' && v !== null && 'id' in v && 'imageUrl' in v,
    )
  )
}

export function invalidateCommunityFitsCache(): Promise<void> {
  return communityFitsCache.invalidate([COMMUNITY_FITS_CACHE_KEY])
}

const fetchActiveCommunityFits = createServerOnlyFn(
  (): Promise<StorefrontCommunityFit[]> =>
    communityFitsCache.get(
      COMMUNITY_FITS_CACHE_KEY,
      async () => {
        // RLS-scoped anon client — the "public read active community fits"
        // policy already limits this to is_active rows; the filter below
        // just makes that explicit.
        const supabase = getSupabaseServerClient()
        const { data, error } = await supabase
          .from('community_fits')
          .select('id, instagram_url, image_url, handle')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: false })
          .limit(60)
        if (error) throw error
        return data.map((row) => ({
          id: row.id,
          instagramUrl: row.instagram_url,
          imageUrl: row.image_url,
          handle: row.handle,
        }))
      },
      { tags: [COMMUNITY_FITS_CACHE_KEY], isValid: isCommunityFitArray },
    ),
)

/** Active Community Fits for the Spades homepage carousel. Never throws —
 *  a failure here hides the section rather than breaking the homepage. */
export const loadCommunityFits = createServerFn({ method: 'GET' }).handler(
  async (): Promise<StorefrontCommunityFit[]> => {
    try {
      return await fetchActiveCommunityFits()
    } catch (err) {
      console.error('Failed to load community fits:', err)
      return []
    }
  },
)

import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '#/lib/supabase/server'
import { createSharedCache } from '#/lib/utils/shared-cache'

export interface StorefrontCommunityFit {
  id: string
  instagramUrl: string
  imageUrl: string
  handle: string
  /** Active Spades products tagged in the photo, in staff-chosen order. */
  products: StorefrontCommunityFitProduct[]
}

export interface StorefrontCommunityFitProduct {
  id: string
  slug: string
  name: string
  /** First product photo, for the small product row under the tile. */
  image: string | null
}

// Tag is what admin writes invalidate; the key carries a shape version so
// entries cached before a field was added are never read back.
const COMMUNITY_FITS_CACHE_TAG = 'storefront-community-fits'
const COMMUNITY_FITS_CACHE_KEY = `${COMMUNITY_FITS_CACHE_TAG}:v2`
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
        typeof v === 'object' &&
        v !== null &&
        'id' in v &&
        'imageUrl' in v &&
        'products' in v,
    )
  )
}

export function invalidateCommunityFitsCache(): Promise<void> {
  return communityFitsCache.invalidate([COMMUNITY_FITS_CACHE_TAG])
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
        if (data.length === 0) return []

        // RLS hides links of hidden fits, and products' own policy hides
        // anything not 'active' — so an archived/draft product just drops
        // off the tile rather than linking to a dead page. Small id lists
        // (at most 60 fits x 10 products), well within .in() limits.
        const { data: links, error: linksError } = await supabase
          .from('community_fit_products')
          .select('fit_id, product_id, sort_order')
          .in(
            'fit_id',
            data.map((row) => row.id),
          )
          .order('sort_order', { ascending: true })
        if (linksError) throw linksError

        const productIds = [...new Set(links.map((l) => l.product_id))]
        const productsById = new Map<string, StorefrontCommunityFitProduct>()
        if (productIds.length > 0) {
          const { data: products, error: productsError } = await supabase
            .from('products')
            .select('id, slug, name, images')
            .in('id', productIds)
            .eq('status', 'active')
          if (productsError) throw productsError
          for (const p of products) {
            productsById.set(p.id, {
              id: p.id,
              slug: p.slug,
              name: p.name,
              image: p.images[0] ?? null,
            })
          }
        }

        return data.map((row) => ({
          id: row.id,
          instagramUrl: row.instagram_url,
          imageUrl: row.image_url,
          handle: row.handle,
          products: links
            .filter((l) => l.fit_id === row.id)
            .map((l) => productsById.get(l.product_id))
            .filter((p) => p !== undefined),
        }))
      },
      { tags: [COMMUNITY_FITS_CACHE_TAG], isValid: isCommunityFitArray },
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

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { STOREFRONT_PAGES } from '#/lib/validation/admin/storefront-sections'
import { getSupabaseServerClient } from '#/lib/supabase/server'
import { listActiveProducts } from '#/server/products/queries'
import { toListingProduct } from '#/lib/utils/product-shape'
import { createSharedCache } from '#/lib/utils/shared-cache'
import type {
  StorefrontListingProduct,
  WithSalePrice,
} from '#/server/products/queries'
import type { StorefrontSection } from '#/types/entities'

const PRODUCT_GRID_PAGE_SIZE = 10

function sectionsCacheKey(page: string, brand: string): string {
  return `storefront-sections:${page}:${brand}`
}

// Same createSharedCache pattern as banner.ts/maintenance.ts — checked on
// every homepage/about-page load, rarely changes. 300s TTL, matching the
// banner precedent for admin-edited CMS content; safe because every write
// path that can change a page's sections (create/update/setActive/delete/
// reorder, all in server/admin/storefront-sections.ts) calls
// invalidateStorefrontSectionsCache(page, brand) immediately after a
// successful write.
const SECTIONS_CACHE_TTL_SECONDS = 300
const sectionsCache = createSharedCache<RenderedStorefrontSection[]>(
  SECTIONS_CACHE_TTL_SECONDS,
)

function isRenderedSectionArray(
  value: unknown,
): value is RenderedStorefrontSection[] {
  return Array.isArray(value)
}

/** Invalidates one page's cached section list for one brand — called by
 *  every admin write path that can change it. Fail-open, same as the cache
 *  itself: never throws, since the write it's cleaning up after has already
 *  succeeded. */
export function invalidateStorefrontSectionsCache(
  page: string,
  brand: string,
): Promise<void> {
  return sectionsCache.invalidate([sectionsCacheKey(page, brand)])
}

export interface RenderedProductGridSection {
  type: 'product_grid'
  id: string
  title: string | null
  titleJa: string | null
  titleKo: string | null
  titleZh: string | null
  linkUrl: string | null
  collectionSlug: string
  products: (StorefrontListingProduct & WithSalePrice)[]
}

export type RenderedStorefrontSection =
  | (StorefrontSection & {
      type: Exclude<StorefrontSection['type'], 'product_grid'>
    })
  | RenderedProductGridSection

/**
 * Active homepage sections in staff-configured order, with product_grid
 * sections' products already fetched — the homepage loader just renders
 * this list, it never needs to know a section came from the database at
 * all. RLS-scoped (anon) client, matching every other public storefront
 * read (see src/server/products/queries.ts).
 *
 * Must be a createServerFn, not a plain async function — this file reads
 * request cookies (via getSupabaseServerClient), and without the
 * createServerFn wrapper TanStack Start can't code-split that server-only
 * code out of the client bundle. Route loaders (like the homepage's) that
 * call a plain exported function directly end up bundling its entire
 * implementation client-side, which the framework's own import-protection
 * plugin then correctly refuses to build.
 */
export const loadStorefrontSections = createServerFn({
  method: 'GET',
})
  .validator(
    z.object({
      page: z.enum(STOREFRONT_PAGES).default('home'),
      brand: z.string().default('spades'),
    }),
  )
  .handler(async ({ data }): Promise<RenderedStorefrontSection[]> => {
    return sectionsCache.get(
      sectionsCacheKey(data.page, data.brand),
      async () => {
        const supabase = getSupabaseServerClient()

        const { data: sections, error } = await supabase
          .from('storefront_sections')
          .select('*, collections(slug)')
          .eq('page', data.page)
          .eq('brand', data.brand)
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .overrideTypes<
            (StorefrontSection & { collections: { slug: string } | null })[],
            { merge: false }
          >()
        if (error) throw error

        return Promise.all(
          sections.map(async (section) => {
            if (section.type !== 'product_grid') {
              return section as RenderedStorefrontSection
            }
            const collectionSlug = section.collections?.slug
            if (!collectionSlug) {
              // Section references a collection that's since been deleted or
              // deactivated — skip it rather than showing an empty/broken block.
              return {
                type: 'product_grid' as const,
                id: section.id,
                title: section.title,
                titleJa: section.title_ja,
                titleKo: section.title_ko,
                titleZh: section.title_zh,
                linkUrl: section.link_url,
                collectionSlug: '',
                products: [],
              }
            }
            const products = await listActiveProducts({
              data: { collectionSlug, limit: PRODUCT_GRID_PAGE_SIZE },
            })
            return {
              type: 'product_grid' as const,
              id: section.id,
              title: section.title,
              titleJa: section.title_ja,
              titleKo: section.title_ko,
              titleZh: section.title_zh,
              linkUrl: section.link_url,
              collectionSlug,
              products: products.map(toListingProduct),
            }
          }),
        )
      },
      {
        tags: [sectionsCacheKey(data.page, data.brand)],
        isValid: isRenderedSectionArray,
      },
    )
  })

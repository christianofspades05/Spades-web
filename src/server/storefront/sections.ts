import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
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

type StorefrontPage = (typeof STOREFRONT_PAGES)[number]

type StorefrontSectionConfigRow = StorefrontSection & {
  collections: { slug: string } | null
}

function storefrontSectionsCacheKey(brand: string, page: string): string {
  return `storefront-sections:${brand}:${page}`
}

// The base storefront_sections config read (title/subtitle/media_url/
// link_url/collection reference/sort_order — everything EXCEPT a
// product_grid section's resolved products) is checked on every single
// homepage/about-page load, but only ever changes via an admin edit. Was
// completely uncached — a Sep 2026 traffic audit found this the same
// process-local/no-cache gap already fixed for markets/collections/
// discounts/banner/maintenance mode, just missed in that earlier sweep.
// Switched to createSharedCache (Vercel Runtime Cache + single-flight),
// 300s TTL — safe because every admin write path that can change a
// section's config (create/update/setActive/delete/reorder, in
// server/admin/storefront-sections.ts) calls
// invalidateStorefrontSectionsCache() for every (brand, page) scope it
// could have affected immediately after a successful write.
//
// Keyed and tagged per (brand, page) — storefront_sections has no other
// column that affects which rows this query returns: is_active is a fixed
// filter (not a caller-supplied parameter), sort_order only affects
// ordering within an already-brand/page-scoped result, and language
// (title_ja/ko/zh etc.) is selected client-side from columns already
// present on every cached row, not a query parameter. Spades/Ysrael/
// Aspire365, and home/about, never share a cache entry.
const STOREFRONT_SECTIONS_CACHE_TTL_SECONDS = 300
const storefrontSectionsCache = createSharedCache<
  StorefrontSectionConfigRow[]
>(STOREFRONT_SECTIONS_CACHE_TTL_SECONDS)

function isStorefrontSectionConfigRowArray(
  value: unknown,
): value is StorefrontSectionConfigRow[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) => typeof v === 'object' && v !== null && 'id' in v && 'type' in v,
    )
  )
}

/** Invalidates one (brand, page) scope's cached section config — called by
 *  every admin write path that can change it. Fail-open, same as the cache
 *  itself: never throws, since the write it's cleaning up after has
 *  already succeeded. */
export function invalidateStorefrontSectionsCache(
  brand: string,
  page: string,
): Promise<void> {
  return storefrontSectionsCache.invalidate([
    storefrontSectionsCacheKey(brand, page),
  ])
}

// Wrapped in createServerOnlyFn, not just a plain function — same reasoning
// as market-pricing.ts's fetchActiveMarketMarkups: lets this be exercised
// directly in tests without a real TanStack Start request context, and
// keeps the framework's import-protection plugin happy since this touches
// a server-only import (getSupabaseServerClient) transitively.
const fetchStorefrontSectionsConfig = createServerOnlyFn(
  async (
    page: StorefrontPage,
    brand: string,
  ): Promise<StorefrontSectionConfigRow[]> => {
    return storefrontSectionsCache.get(
      storefrontSectionsCacheKey(brand, page),
      async () => {
        const supabase = getSupabaseServerClient()
        const { data: sections, error } = await supabase
          .from('storefront_sections')
          .select('*, collections(slug)')
          .eq('page', page)
          .eq('brand', brand)
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .overrideTypes<StorefrontSectionConfigRow[], { merge: false }>()
        if (error) throw error
        return sections
      },
      {
        tags: [storefrontSectionsCacheKey(brand, page)],
        isValid: isStorefrontSectionConfigRowArray,
      },
    )
  },
)

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
 * read (see src/server/products/queries.ts). The base config read is
 * shared-cached (see fetchStorefrontSectionsConfig above); product_grid
 * resolution below is unchanged and NOT part of that cache — each
 * product_grid section still resolves its products fresh through
 * listActiveProducts' own existing caching.
 *
 * Wrapped in createServerOnlyFn, not just a plain function — same
 * reasoning as fetchStorefrontSectionsConfig: lets this be exercised
 * directly in tests without a real TanStack Start request context.
 */
export const resolveStorefrontSections = createServerOnlyFn(
  async (
    page: StorefrontPage,
    brand: string,
  ): Promise<RenderedStorefrontSection[]> => {
    const sections = await fetchStorefrontSectionsConfig(page, brand)

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
)

/**
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
  .handler(
    ({ data }): Promise<RenderedStorefrontSection[]> =>
      resolveStorefrontSections(data.page, data.brand),
  )

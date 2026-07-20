import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { STOREFRONT_PAGES } from '#/lib/validation/admin/storefront-sections'
import { getSupabaseServerClient } from '#/lib/supabase/server'
import { listActiveProducts } from '#/server/products/queries'
import { toListingProduct } from '#/lib/utils/product-shape'
import type { StorefrontListingProduct, WithSalePrice } from '#/server/products/queries'
import type { StorefrontSection } from '#/types/entities'

const PRODUCT_GRID_PAGE_SIZE = 10

export interface RenderedProductGridSection {
  type: 'product_grid'
  id: string
  title: string | null
  linkUrl: string | null
  collectionSlug: string
  products: (StorefrontListingProduct & WithSalePrice)[]
}

export type RenderedStorefrontSection =
  | (StorefrontSection & { type: Exclude<StorefrontSection['type'], 'product_grid'> })
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
  .validator(z.object({ page: z.enum(STOREFRONT_PAGES).default('home') }))
  .handler(async ({ data }): Promise<RenderedStorefrontSection[]> => {
  const supabase = getSupabaseServerClient()

  const { data: sections, error } = await supabase
    .from('storefront_sections')
    .select('*, collections(slug)')
    .eq('page', data.page)
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
        linkUrl: section.link_url,
        collectionSlug,
        products: products.map(toListingProduct),
      }
    }),
  )
})

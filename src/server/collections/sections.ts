import { listActiveProducts } from '#/server/products/queries'
import { toListingProduct } from '#/lib/utils/product-shape'
import { STOREFRONT_COLLECTIONS } from '#/lib/collections/display'
import type { StorefrontListingProduct } from '#/server/products/queries'

export const MAX_PRODUCTS_SHOWN = 20
/** Comfortably above any real collection size today, so we can tell if a collection has more than MAX_PRODUCTS_SHOWN. */
const FETCH_LIMIT = 100

export interface StorefrontCollectionSection {
  slug: string
  title: string
  total: number
  products: StorefrontListingProduct[]
}

/** Fetches each curated storefront collection's first MAX_PRODUCTS_SHOWN products, for the homepage and /collections. */
export async function loadStorefrontCollectionSections(): Promise<
  StorefrontCollectionSection[]
> {
  return Promise.all(
    STOREFRONT_COLLECTIONS.map(async ({ slug, title }) => {
      const products = await listActiveProducts({
        data: { collectionSlug: slug, limit: FETCH_LIMIT },
      })
      return {
        slug,
        title,
        total: products.length,
        products: products.slice(0, MAX_PRODUCTS_SHOWN).map(toListingProduct),
      }
    }),
  )
}

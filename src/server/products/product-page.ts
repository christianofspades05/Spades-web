/**
 * Everything the product detail page (routes/products/$slug.tsx) needs,
 * gathered behind a single createServerFn call instead of the 3 separate
 * ones this used to be (getProductBySlug, listRelatedProducts,
 * getProductReviews — still called independently elsewhere, unchanged).
 * Same reduction rationale as server/storefront/root-loader.ts: a
 * createServerFn's handler only ever runs server-side, so calling these
 * three from inside this one resolves in-process instead of costing a
 * real network request per call on every client-side navigation to a
 * product page.
 *
 * Calls each function's plain (non-createServerFn) implementation
 * directly — resolveProductBySlug, resolveRelatedProducts,
 * resolveProductReviews — rather than the createServerFn-wrapped exports,
 * same fix as root-loader.ts's history: a nested createServerFn-to-
 * createServerFn call isn't reliably resolved in-process by the
 * production build, only by local `vite dev`.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { STOREFRONT_BRANDS } from '#/lib/validation/admin/storefront-sections'
import {
  resolveProductBySlug,
  resolveRelatedProducts,
} from '#/server/products/queries'
import type { ProductBySlugResult } from '#/server/products/queries'
import { resolveProductReviews } from '#/server/reviews/queries'
import type { ProductReviews } from '#/server/reviews/queries'

export interface ProductPageData {
  product: ProductBySlugResult
  related: Awaited<ReturnType<typeof resolveRelatedProducts>>
  reviews: ProductReviews
}

const EMPTY_REVIEWS: ProductReviews = {
  reviews: [],
  reviewCount: 0,
  averageRating: 0,
}

export const getProductPageData = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      slug: z.string().min(1),
      brand: z.enum(STOREFRONT_BRANDS),
    }),
  )
  .handler(async ({ data }): Promise<ProductPageData> => {
    const product = await resolveProductBySlug(data.slug, data.brand)
    if (!product) return { product: null, related: [], reviews: EMPTY_REVIEWS }

    const [related, reviews] = await Promise.all([
      resolveRelatedProducts({
        productType: product.product_type,
        excludeProductId: product.id,
        limit: 4,
        brand: data.brand,
      }),
      resolveProductReviews(product.id),
    ])

    return { product, related, reviews }
  })

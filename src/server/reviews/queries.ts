/**
 * Public storefront reads for approved reviews. Uses the anon-key request
 * client, not the admin client — approved reviews are readable by anyone via
 * the "public read approved reviews" RLS policy (see
 * supabase/migrations/0014_reviews.sql), same convention as products/collections.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSupabaseServerClient } from '#/lib/supabase/server'
import type { Review } from '#/types/entities'

export interface ProductReviews {
  reviews: Review[]
  averageRating: number
  reviewCount: number
}

export const getProductReviews = createServerFn({ method: 'GET' })
  .validator(z.object({ productId: z.string().uuid() }))
  .handler(async ({ data }): Promise<ProductReviews> => {
    const supabase = getSupabaseServerClient()

    const { data: reviews, error } = await supabase
      .from('reviews')
      .select('*')
      .eq('product_id', data.productId)
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
    if (error) throw error

    const reviewCount = reviews.length
    const averageRating =
      reviewCount === 0
        ? 0
        : reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount

    return { reviews, averageRating, reviewCount }
  })

export interface StorefrontReview {
  id: string
  rating: number
  reviewText: string | null
  customerName: string | null
  product: { id: string; name: string; slug: string; image: string | null }
}

export interface StorefrontReviews {
  reviews: StorefrontReview[]
  averageRating: number
  reviewCount: number
}

/** All approved reviews site-wide, for the /reviews page's "let customers speak for us" carousel. */
export const listStorefrontReviews = createServerFn({ method: 'GET' }).handler(
  async (): Promise<StorefrontReviews> => {
    const supabase = getSupabaseServerClient()

    const { data: reviews, error } = await supabase
      .from('reviews')
      .select('id, product_id, rating, review_text, customer_name')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) throw error

    const reviewCount = reviews.length
    const averageRating =
      reviewCount === 0
        ? 0
        : reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount

    const productIds = Array.from(new Set(reviews.map((r) => r.product_id)))
    const { data: products, error: productsError } =
      productIds.length > 0
        ? await supabase
            .from('products')
            .select('id, name, slug, images')
            .in('id', productIds)
        : { data: [], error: null }
    if (productsError) throw productsError

    const productsById = new Map(products.map((p) => [p.id, p]))

    return {
      reviews: reviews
        .filter((r) => productsById.has(r.product_id))
        .map((r) => {
          const product = productsById.get(r.product_id)!
          return {
            id: r.id,
            rating: r.rating,
            reviewText: r.review_text,
            customerName: r.customer_name,
            product: {
              id: product.id,
              name: product.name,
              slug: product.slug,
              image: product.images[0] ?? null,
            },
          }
        }),
      averageRating,
      reviewCount,
    }
  },
)

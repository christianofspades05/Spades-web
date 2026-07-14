/**
 * Server functions for public product/catalog reads.
 *
 * These use the request-scoped Supabase client (anon key), not the admin
 * client — catalog data is public by RLS policy (see
 * supabase/migrations/0001_init_schema.sql), so there's no reason to run
 * these with elevated privileges. Price is always read from
 * `product_variants.price_cents` here; nothing in this file accepts a price
 * from the caller.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSupabaseServerClient } from '#/lib/supabase/server'
import type { ProductWithVariants } from '#/types/entities'

export const listActiveProducts = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      collectionSlug: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(24),
    }),
  )
  .handler(async ({ data }): Promise<ProductWithVariants[]> => {
    const supabase = getSupabaseServerClient()

    let query = supabase
      .from('products')
      .select('*, variants:product_variants(*)')
      .eq('status', 'active')
      .limit(data.limit)

    if (data.collectionSlug) {
      const { data: collection } = await supabase
        .from('collections')
        .select('id')
        .eq('slug', data.collectionSlug)
        .eq('is_active', true)
        .maybeSingle<{ id: string }>()

      if (!collection) return []

      const { data: productIds } = await supabase
        .from('product_collections')
        .select('product_id')
        .eq('collection_id', collection.id)
        .overrideTypes<{ product_id: string }[], { merge: false }>()

      const ids = (productIds ?? []).map((row) => row.product_id)
      if (ids.length === 0) return []

      query = query.in('id', ids)
    }

    const { data: products, error } = await query
    if (error) throw error
    return products
  })

export const getProductBySlug = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string().min(1) }))
  .handler(async ({ data }): Promise<ProductWithVariants | null> => {
    const supabase = getSupabaseServerClient()

    const { data: product, error } = await supabase
      .from('products')
      .select('*, variants:product_variants(*)')
      .eq('slug', data.slug)
      .eq('status', 'active')
      .maybeSingle()

    if (error) throw error
    return product
  })

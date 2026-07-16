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
import { collectionRuleSchema, matchesRules } from '#/lib/collections/rules'
import type { SortOption } from '#/lib/collections/rules'
import {
  listStorefrontProductsSchema,
  PRODUCT_TYPES,
} from '#/lib/validation/product-listing'
import type { ProductWithVariants } from '#/types/entities'
import type { Database } from '#/types/database.types'

export type StorefrontListingProduct =
  Database['public']['Views']['storefront_product_listing']['Row']

interface ProductWithStock extends ProductWithVariants {
  variants: (ProductWithVariants['variants'][number] & {
    inventory: { quantity_available: number }[]
  })[]
}

function inventoryStockOf(product: ProductWithStock): number {
  return product.variants.reduce(
    (sum, v) =>
      sum + v.inventory.reduce((s, inv) => s + inv.quantity_available, 0),
    0,
  )
}

function lowestPriceCentsOf(product: ProductWithStock): number | null {
  return product.variants.reduce<number | null>(
    (min, v) => (min === null || v.price_cents < min ? v.price_cents : min),
    null,
  )
}

function sortProducts(
  products: ProductWithStock[],
  sortBy: SortOption,
): ProductWithStock[] {
  const withPrice = products.map((p) => ({
    product: p,
    price: lowestPriceCentsOf(p) ?? 0,
  }))
  withPrice.sort((a, b) => {
    switch (sortBy) {
      case 'title_asc':
        return a.product.name.localeCompare(b.product.name)
      case 'title_desc':
        return b.product.name.localeCompare(a.product.name)
      case 'price_asc':
        return a.price - b.price
      case 'price_desc':
        return b.price - a.price
      case 'created_asc':
        return (
          new Date(a.product.created_at).getTime() -
          new Date(b.product.created_at).getTime()
        )
      case 'created_desc':
      default:
        return (
          new Date(b.product.created_at).getTime() -
          new Date(a.product.created_at).getTime()
        )
    }
  })
  return withPrice.map((p) => p.product)
}

export const listActiveProducts = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      collectionSlug: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(24),
    }),
  )
  .handler(async ({ data }): Promise<ProductWithVariants[]> => {
    const supabase = getSupabaseServerClient()

    if (!data.collectionSlug) {
      const { data: products, error } = await supabase
        .from('products')
        .select('*, variants:product_variants(*)')
        .eq('status', 'active')
        .limit(data.limit)
      if (error) throw error
      return products
    }

    const { data: collection } = await supabase
      .from('collections')
      .select('id, match_type, rules, sort_by, hide_out_of_stock_products')
      .eq('slug', data.collectionSlug)
      .eq('is_active', true)
      .maybeSingle<{
        id: string
        match_type: 'all' | 'any'
        rules: unknown
        sort_by: string
        hide_out_of_stock_products: boolean
      }>()
    if (!collection) return []

    const [{ data: products, error }, { data: memberships }] =
      await Promise.all([
        supabase
          .from('products')
          .select(
            '*, variants:product_variants(*, inventory(quantity_available))',
          )
          .eq('status', 'active')
          .overrideTypes<ProductWithStock[], { merge: false }>(),
        supabase
          .from('product_collections')
          .select('product_id, sort_order')
          .eq('collection_id', collection.id)
          .order('sort_order', { ascending: true })
          .overrideTypes<
            { product_id: string; sort_order: number }[],
            { merge: false }
          >(),
      ])
    if (error) throw error

    // Manually pinned products always stay in, regardless of `rules` — they
    // lead the list in their drag order, then rule-matched products fill in
    // after (deduped), sorted by `sort_by`.
    const orderById = new Map(
      (memberships ?? []).map((m) => [m.product_id, m.sort_order]),
    )
    const manual = products
      .filter((p) => orderById.has(p.id))
      .sort((a, b) => orderById.get(a.id)! - orderById.get(b.id)!)

    const rules = z.array(collectionRuleSchema).parse(collection.rules)
    const autoMatched = sortProducts(
      products.filter(
        (p) =>
          !orderById.has(p.id) &&
          matchesRules(
            {
              name: p.name,
              productType: p.product_type,
              status: p.status,
              tags: p.tags,
              inventoryStock: inventoryStockOf(p),
              lowestPriceCents: lowestPriceCentsOf(p),
            },
            rules,
            collection.match_type,
          ),
      ),
      collection.sort_by as SortOption,
    )

    let matching = [...manual, ...autoMatched]
    if (collection.hide_out_of_stock_products) {
      matching = matching.filter((p) => inventoryStockOf(p) > 0)
    }

    return matching.slice(0, data.limit)
  })

export const getProductBySlug = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string().min(1) }))
  .handler(async ({ data }): Promise<ProductWithVariants | null> => {
    const supabase = getSupabaseServerClient()

    const { data: product, error } = await supabase
      .from('products')
      .select('*, variants:product_variants(*, inventory(quantity_available))')
      .eq('slug', data.slug)
      .eq('status', 'active')
      .maybeSingle()

    if (error) throw error
    return product
  })

/**
 * Paginated, filterable, sortable, searchable product listing for the
 * /products page. Reads from `storefront_product_listing`, a view that
 * precomputes each product's lowest variant price and total available stock
 * (see supabase/migrations/0008_storefront_product_listing_view.sql) — price
 * and stock both live one join away from `products`, so a plain PostgREST
 * filter on `products` can't paginate/sort/filter by them.
 */
export const listStorefrontProducts = createServerFn({ method: 'GET' })
  .validator(listStorefrontProductsSchema)
  .handler(
    async ({
      data,
    }): Promise<{ products: StorefrontListingProduct[]; total: number }> => {
      const supabase = getSupabaseServerClient()

      let query = supabase
        .from('storefront_product_listing')
        .select('*', { count: 'exact' })

      if (data.type) query = query.eq('product_type', data.type)
      if (data.q) {
        query = query.or(`name.ilike.%${data.q}%,tags.cs.{${data.q}}`)
      }
      if (data.minPriceCents != null) {
        query = query.gte('min_price_cents', data.minPriceCents)
      }
      if (data.maxPriceCents != null) {
        query = query.lte('min_price_cents', data.maxPriceCents)
      }
      if (data.inStock) query = query.gt('total_stock', 0)

      switch (data.sort) {
        case 'price_asc':
          query = query.order('min_price_cents', { ascending: true })
          break
        case 'price_desc':
          query = query.order('min_price_cents', { ascending: false })
          break
        case 'newest':
        default:
          query = query.order('created_at', { ascending: false })
          break
      }

      const from = (data.page - 1) * data.pageSize
      const to = from + data.pageSize - 1
      const { data: products, error, count } = await query.range(from, to)

      if (error) throw error
      return { products, total: count ?? 0 }
    },
  )

/** Active products sharing a product_type, for a detail page's "related products" section. */
export const listRelatedProducts = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      productType: z.enum(PRODUCT_TYPES),
      excludeProductId: z.string().uuid(),
      limit: z.number().int().min(1).max(24).default(4),
    }),
  )
  .handler(async ({ data }): Promise<StorefrontListingProduct[]> => {
    const supabase = getSupabaseServerClient()

    const { data: products, error } = await supabase
      .from('storefront_product_listing')
      .select('*')
      .eq('product_type', data.productType)
      .neq('id', data.excludeProductId)
      .limit(data.limit)

    if (error) throw error
    return products
  })

/** Distinct product_type values among active products, for the home page category nav. */
export const listActiveProductTypesInUse = createServerFn({
  method: 'GET',
}).handler(async (): Promise<string[]> => {
  const supabase = getSupabaseServerClient()

  const { data, error } = await supabase
    .from('products')
    .select('product_type')
    .eq('status', 'active')

  if (error) throw error
  return Array.from(new Set(data.map((p) => p.product_type)))
})

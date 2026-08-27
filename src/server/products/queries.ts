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
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSupabaseServerClient } from '#/lib/supabase/server'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { collectionRuleSchema, matchesRules } from '#/lib/collections/rules'
import type { SortOption } from '#/lib/collections/rules'
import { normalizeSearchTerm } from '#/lib/utils/search'
import {
  listStorefrontProductsSchema,
  PRODUCT_TYPES,
} from '#/lib/validation/product-listing'
import { STOREFRONT_BRANDS } from '#/lib/validation/admin/storefront-sections'
import {
  getActiveAutomaticDiscounts,
  resolveSalePrices,
} from '#/server/storefront/automatic-sales'
import { createPromiseCache } from '#/lib/utils/cache'
import type { ProductWithVariants } from '#/types/entities'
import type { Database, ProductBrand } from '#/types/database.types'

export type StorefrontListingProduct =
  Database['public']['Views']['storefront_product_listing']['Row']

/** salePriceCents is null when no active Store/Collection sale currently beats this product's regular price — the common case, so every listing/detail read below attaches it rather than making callers opt in. */
export interface WithSalePrice {
  salePriceCents: number | null
  saleTitle: string | null
}

/**
 * Attaches each product's current sale price (if any active automatic
 * discount — Store sale or Collection sale — applies), given only its id
 * and regular (lowest-variant) price. Uses the admin client for this one
 * read regardless of which client fetched the products themselves — sale
 * eligibility is public, non-sensitive information (it's about to be shown
 * on the storefront either way), and discounts isn't part of this file's
 * RLS-scoped catalog reads.
 */
async function attachSalePrices<
  T extends { id: string; productId?: string; priceCents: number },
>(products: T[]): Promise<Map<string, WithSalePrice>> {
  const result = new Map<string, WithSalePrice>()
  if (products.length === 0) return result

  const admin = getSupabaseAdminClient()
  const activeDiscounts = await getActiveAutomaticDiscounts(admin)
  const sales = await resolveSalePrices(admin, activeDiscounts, products)

  for (const product of products) {
    const sale = sales.get(product.id)
    result.set(product.id, {
      salePriceCents: sale?.salePriceCents ?? null,
      saleTitle: sale?.discountTitle ?? null,
    })
  }
  return result
}

/** Same as attachSalePrices, but for a full product+variants shape (used by listActiveProducts, which — unlike the storefront_product_listing view — has no precomputed min_price_cents of its own). */
async function withSalePrices<T extends ProductWithVariants>(
  products: T[],
): Promise<(T & WithSalePrice)[]> {
  const sales = await attachSalePrices(
    products.map((p) => ({
      id: p.id,
      priceCents:
        p.variants.reduce<number | null>(
          (min, v) =>
            min === null || v.price_cents < min ? v.price_cents : min,
          null,
        ) ?? 0,
    })),
  )
  return products.map((p) => ({
    ...p,
    ...(sales.get(p.id) ?? { salePriceCents: null, saleTitle: null }),
  }))
}

interface ProductWithStock extends ProductWithVariants {
  variants: (ProductWithVariants['variants'][number] & {
    inventory: { quantity_available: number }[]
  })[]
}

// Every product_grid section on a page independently needed "every active
// product (with all variants+inventory) for rule-matching" — on a homepage
// with several such sections, that's several concurrent full, unbounded,
// heavily-joined table scans per page load, multiplied again by however many
// visitors load the page at once. That's exactly what took the database down
// during the 2026-08-04 incident (dozens of identical
// `products?select=*,variants:product_variants(*,inventory(...))&status=eq.active`
// calls firing within the same second, several timing out).
//
// Scoping to one brand shrinks the row count. The cache stores the in-flight
// *promise*, not just the resolved value — a plain resolved-value TTL cache
// (see lib/utils/cache.ts's createTtlCache) doesn't help here, because every
// section's Promise.all branch reaches this function in the same tick,
// before any of them has awaited far enough to populate a value-only cache.
// Caching the promise itself means every one of those concurrent callers
// awaits the exact same single DB round trip.
const ACTIVE_PRODUCTS_CACHE_TTL_MS = 15_000
const activeProductsByBrand = new Map<
  ProductBrand,
  { expiresAt: number; promise: Promise<ProductWithStock[]> }
>()

function getActiveProductsForBrand(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  brand: ProductBrand,
): Promise<ProductWithStock[]> {
  const cached = activeProductsByBrand.get(brand)
  if (cached && cached.expiresAt > Date.now()) return cached.promise

  const promise = (async () => {
    const { data: products, error } = await supabase
      .from('products')
      .select(
        '*, variants:product_variants(*, inventory(quantity_available))',
      )
      .eq('status', 'active')
      .eq('brand', brand)
      .overrideTypes<ProductWithStock[], { merge: false }>()
    if (error) throw error
    return products
  })()

  activeProductsByBrand.set(brand, {
    expiresAt: Date.now() + ACTIVE_PRODUCTS_CACHE_TTL_MS,
    promise,
  })
  // A failed fetch shouldn't keep serving the same rejection to every other
  // caller for the rest of the TTL window — clear it so the next call
  // retries fresh instead of every section erroring out together.
  promise.catch(() => activeProductsByBrand.delete(brand))
  return promise
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

// Collections dedicated to another brand's storefront — blocked from
// direct-URL browsing on Spades' own /collections/$slug (see
// routes/collections/$slug.tsx). Brand *product* scoping itself no longer
// depends on these (see products.brand, migration 0051); this list is only
// for that one URL-blocking check.
export const OTHER_BRAND_COLLECTION_SLUGS = ['ysrael', 'aspire-365']

interface CollectionMetadata {
  id: string
  brand: ProductBrand
  match_type: 'all' | 'any'
  rules: unknown
  sort_by: string
  hide_out_of_stock_products: boolean
  max_products: number | null
}

interface CollectionListingScope {
  collection: CollectionMetadata | null
  memberships: { product_id: string; sort_order: number }[]
}

// listActiveProducts' own collection-slug lookup + membership list — called
// once per product_grid section on every homepage load (13x on Spades' Home
// alone, via loadStorefrontSections), independent of and uncovered by
// resolveCollectionScopedProductIds' own cache (that one only covers the
// active-discount scoping done later in this same function, via
// withSalePrices). Same 15s TTL/promise-caching pattern as
// getActiveProductsForBrand right below: collection metadata/membership
// barely ever changes (a staff edit in admin), so every concurrent section
// resolving the same collection slug within the TTL window shares one real
// Supabase round trip instead of firing its own pair. Keyed by
// collectionSlug alone — `collections.slug` has a database-level global
// UNIQUE constraint (collections_slug_key), not scoped per brand, so a
// Spades and a Ysrael/Aspire365 collection can never share a slug; no brand
// needs to be added to the key.
const COLLECTION_LISTING_SCOPE_CACHE_TTL_MS = 15_000
const collectionListingScopeCache = createPromiseCache<CollectionListingScope>(
  COLLECTION_LISTING_SCOPE_CACHE_TTL_MS,
)

async function fetchCollectionListingScope(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  collectionSlug: string,
): Promise<CollectionListingScope> {
  const { data: collection } = await supabase
    .from('collections')
    .select(
      'id, brand, match_type, rules, sort_by, hide_out_of_stock_products, max_products',
    )
    .eq('slug', collectionSlug)
    .eq('is_active', true)
    .maybeSingle<CollectionMetadata>()
  if (!collection) return { collection: null, memberships: [] }

  const { data: memberships, error } = await supabase
    .from('product_collections')
    .select('product_id, sort_order')
    .eq('collection_id', collection.id)
    .order('sort_order', { ascending: true })
    .overrideTypes<
      { product_id: string; sort_order: number }[],
      { merge: false }
    >()
  if (error) throw error

  return { collection, memberships }
}

export const listActiveProducts = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      collectionSlug: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(24),
    }),
  )
  .handler(
    async ({ data }): Promise<(ProductWithVariants & WithSalePrice)[]> => {
      const supabase = getSupabaseServerClient()

      if (!data.collectionSlug) {
        const { data: products, error } = await supabase
          .from('products')
          .select('*, variants:product_variants(*)')
          .eq('status', 'active')
          .limit(data.limit)
        if (error) throw error
        return withSalePrices(products)
      }
      const collectionSlug = data.collectionSlug

      const { collection, memberships } = await collectionListingScopeCache.get(
        collectionSlug,
        () => fetchCollectionListingScope(supabase, collectionSlug),
      )
      if (!collection) return []

      const products = await getActiveProductsForBrand(supabase, collection.brand)

      // Manually pinned products always stay in, regardless of `rules` — they
      // lead the list in their drag order, then rule-matched products fill in
      // after (deduped), sorted by `sort_by`.
      const orderById = new Map(
        memberships.map((m) => [m.product_id, m.sort_order]),
      )
      const manual = products
        .filter((p) => orderById.has(p.id))
        .sort((a, b) => orderById.get(a.id)! - orderById.get(b.id)!)

      const rules = z.array(collectionRuleSchema).parse(collection.rules)
      const autoMatched = sortProducts(
        products.filter(
          (p) =>
            !orderById.has(p.id) &&
            // Unlike manual pins (never excluded — a deliberate override),
            // auto-matched products are scoped to the collection's own
            // brand. products.brand and collections.brand share the same
            // three values (spades/ysrael/aspire365) but there's no
            // relational tie between them — without this, a Spades-side
            // collection with e.g. a bare "status = active" rule would pull
            // in Ysrael/Aspire 365 products too, since they all live in one
            // shared products table.
            p.brand === collection.brand &&
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
      // Manual pins always take the first slots; max_products (e.g. a "New
      // Arrivals" collection capped at 6) trims from the auto-matched tail.
      const cap =
        collection.max_products !== null
          ? Math.min(collection.max_products, data.limit)
          : data.limit

      return withSalePrices(matching.slice(0, cap))
    },
  )

export type VariantWithSalePrice = ProductWithVariants['variants'][number] & {
  inventory: { quantity_available: number }[]
} & WithSalePrice

export type ProductBySlugResult =
  | (Omit<ProductWithVariants, 'variants'> & {
      variants: VariantWithSalePrice[]
    })
  | null

/**
 * Wrapped in createServerOnlyFn, not just a plain function, so
 * server/products/product-page.ts can call it directly — see
 * server/storefront/domain.ts's checkNonCanonicalVercelHostRedirect doc
 * comment for the full reasoning.
 */
export const resolveProductBySlug = createServerOnlyFn(
  async (
    slug: string,
    brand: (typeof STOREFRONT_BRANDS)[number],
  ): Promise<ProductBySlugResult> => {
    const supabase = getSupabaseServerClient()
    const admin = getSupabaseAdminClient()

    // getActiveAutomaticDiscounts doesn't depend on the product row at all,
    // so it runs alongside the product fetch instead of after it — on a
    // cold serverless instance (empty caches, fresh DB connections) this was
    // a real, avoidable chunk of this page's slow first hit.
    const [{ data: product, error }, activeDiscounts] = await Promise.all([
      supabase
        .from('products')
        .select('*, variants:product_variants(*, inventory(quantity_available))')
        .eq('slug', slug)
        .eq('status', 'active')
        .eq('brand', brand)
        .order('sort_order', { foreignTable: 'variants' })
        .maybeSingle(),
      getActiveAutomaticDiscounts(admin),
    ])

    if (error) throw error
    if (!product) return null

    // Each variant priced (and its best discount picked) individually — its
    // own price is what a shopper who picks that size/color actually pays,
    // and collection membership is checked against the shared product id
    // regardless (see resolveSalePrices' productId param).
    const sales = await resolveSalePrices(
      admin,
      activeDiscounts,
      product.variants.map((v) => ({
        id: v.id,
        productId: product.id,
        priceCents: v.price_cents,
      })),
    )

    return {
      ...product,
      variants: product.variants.map((v) => {
        const sale = sales.get(v.id)
        return {
          ...v,
          salePriceCents: sale?.salePriceCents ?? null,
          saleTitle: sale?.discountTitle ?? null,
        }
      }),
    }
  },
)

export const getProductBySlug = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      slug: z.string().min(1),
      // The current domain's brand (see server/storefront/domain.ts) — a
      // product belonging to another brand doesn't exist as far as this
      // storefront is concerned.
      brand: z.enum(STOREFRONT_BRANDS),
    }),
  )
  .handler(
    ({ data }): Promise<ProductBySlugResult> =>
      resolveProductBySlug(data.slug, data.brand),
  )

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
    }): Promise<{
      products: (StorefrontListingProduct & WithSalePrice)[]
      total: number
    }> => {
      const supabase = getSupabaseServerClient()

      let query = supabase
        .from('storefront_product_listing')
        .select('*', { count: 'exact' })
        .eq('brand', data.brand)

      if (data.type) query = query.eq('product_type', data.type)
      if (data.q) {
        const normalized = normalizeSearchTerm(data.q)
        query = query.or(
          `name_search.ilike.%${normalized}%,tags.cs.{${data.q}}`,
        )
      }
      if (data.minPriceCents != null) {
        query = query.gte('min_price_cents', data.minPriceCents)
      }
      if (data.maxPriceCents != null) {
        query = query.lte('min_price_cents', data.maxPriceCents)
      }
      if (data.inStock) query = query.gt('total_stock', 0)

      // Every sort column here ties often (total_stock especially — a small
      // integer shared by dozens of products) and .range() below runs as a
      // fresh query per page, so without a deterministic tiebreaker Postgres
      // is free to order tied rows differently between page requests —
      // products silently reshuffle, repeat across pages, or get skipped
      // entirely while paging through "Inventory: High to Low". `id` is
      // unique per row, so appending it as a secondary sort fully
      // determines the order regardless of ties on the primary column.
      switch (data.sort) {
        case 'price_asc':
          query = query.order('min_price_cents', { ascending: true })
          break
        case 'price_desc':
          query = query.order('min_price_cents', { ascending: false })
          break
        case 'newest':
          query = query.order('created_at', { ascending: false })
          break
        case 'stock_desc':
        default:
          query = query.order('total_stock', { ascending: false })
          break
      }
      query = query.order('id', { ascending: true })

      const from = (data.page - 1) * data.pageSize
      const to = from + data.pageSize - 1
      const { data: products, error, count } = await query.range(from, to)

      if (error) throw error
      const sales = await attachSalePrices(
        products.map((p) => ({ id: p.id, priceCents: p.min_price_cents })),
      )
      return {
        products: products.map((p) => ({
          ...p,
          ...(sales.get(p.id) ?? { salePriceCents: null, saleTitle: null }),
        })),
        total: count ?? 0,
      }
    },
  )

const QUICK_SEARCH_LIMIT = 6

/** Small, unpaginated product lookup backing the header's in-place search overlay — a live-typing dropdown, not the full /products listing. */
export const quickSearchProducts = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      q: z.string().trim().min(1).max(200),
      // The current domain's brand (see server/storefront/domain.ts) —
      // search never surfaces a product belonging to another brand.
      brand: z.enum(STOREFRONT_BRANDS),
    }),
  )
  .handler(
    async ({ data }): Promise<(StorefrontListingProduct & WithSalePrice)[]> => {
      const supabase = getSupabaseServerClient()

      const normalizedQuery = normalizeSearchTerm(data.q)
      const query = supabase
        .from('storefront_product_listing')
        .select('*')
        .eq('brand', data.brand)
        .or(`name_search.ilike.%${normalizedQuery}%,tags.cs.{${data.q}}`)
        .order('created_at', { ascending: false })
      const { data: products, error } = await query.limit(QUICK_SEARCH_LIMIT)

      if (error) throw error
      const sales = await attachSalePrices(
        products.map((p) => ({ id: p.id, priceCents: p.min_price_cents })),
      )
      return products.map((p) => ({
        ...p,
        ...(sales.get(p.id) ?? { salePriceCents: null, saleTitle: null }),
      }))
    },
  )

export interface ListRelatedProductsInput {
  productType: (typeof PRODUCT_TYPES)[number]
  excludeProductId: string
  limit?: number
  brand: (typeof STOREFRONT_BRANDS)[number]
}

/** createServerOnlyFn, not just a plain function — same reasoning as resolveProductBySlug above. */
export const resolveRelatedProducts = createServerOnlyFn(
  async (
    input: ListRelatedProductsInput,
  ): Promise<(StorefrontListingProduct & WithSalePrice)[]> => {
    const supabase = getSupabaseServerClient()

    const query = supabase
      .from('storefront_product_listing')
      .select('*')
      .eq('brand', input.brand)
      .eq('product_type', input.productType)
      .neq('id', input.excludeProductId)
      .gt('total_stock', 0)
    const { data: products, error } = await query.limit(input.limit ?? 4)

    if (error) throw error
    const sales = await attachSalePrices(
      products.map((p) => ({ id: p.id, priceCents: p.min_price_cents })),
    )
    return products.map((p) => ({
      ...p,
      ...(sales.get(p.id) ?? { salePriceCents: null, saleTitle: null }),
    }))
  },
)

/** Active products sharing a product_type, for a detail page's "related products" section. */
export const listRelatedProducts = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      productType: z.enum(PRODUCT_TYPES),
      excludeProductId: z.string().uuid(),
      limit: z.number().int().min(1).max(24).default(4),
      // The current domain's brand (see server/storefront/domain.ts) —
      // "related products" never surfaces a product belonging to another
      // brand (e.g. Spades items on Aspire 365's product pages).
      brand: z.enum(STOREFRONT_BRANDS),
    }),
  )
  .handler(
    ({ data }): Promise<(StorefrontListingProduct & WithSalePrice)[]> =>
      resolveRelatedProducts(data),
  )

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

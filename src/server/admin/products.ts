import { randomUUID } from 'node:crypto'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  duplicateProductSchema,
  inventoryAdjustmentSchema,
  productInputSchema,
  quickEditVariantSchema,
  restockSchema,
  setProductCollectionsSchema,
  updateProductSchema,
  updateVariantSchema,
  productImageUploadUrlSchema,
  variantInputSchema,
} from '#/lib/validation/admin/products'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { pesosToCents } from '#/lib/utils/money'
import { slugify } from '#/lib/utils/slug'
import { normalizeSearchTerm } from '#/lib/utils/search'
import { storeRangeToUtcBounds } from '#/lib/utils/date-range'
import { pushInventoryForVariant } from '#/server/integrations/marketplaces/sync-engine'
import { resolveCollectionScopedProductIds } from '#/server/collections/scoped-products'
import { chunkArray, fetchAllRows } from '#/lib/utils/paginate'
import {
  invalidateCollectionListingCache,
  invalidateProductDetailCache,
  invalidateStorefrontListingCache,
} from '#/server/products/queries'
import { logStaffActivity } from './activity-log'
import type {
  Inventory,
  Product,
  ProductVariant,
  StaffRole,
} from '#/types/entities'
import type { ProductStatus, ProductType } from '#/types/database.types'

// Not `as const` — requireStaff expects a plain mutable StaffRole[].
const MANAGE_ROLES: StaffRole[] = ['super_admin', 'admin', 'manager']

interface VariantWithInventory extends ProductVariant {
  inventory: Inventory[]
}
interface ProductWithDetails extends Product {
  variants: VariantWithInventory[]
  collections: Array<{ collection_id: string }>
}
export interface ProductWithCollectionNames extends ProductWithDetails {
  collections: Array<{ collection_id: string; collection: { name: string } }>
}

// Maps the list page's sort dropdown to a real column on `products` itself.
// 'inventory' has no such column — total on-hand stock only exists as an
// aggregate over each product's variants/inventory rows — so it's handled
// as its own branch below instead, via admin_product_listing.
const SORT_COLUMNS = {
  title: 'name',
  type: 'product_type',
  created: 'created_at',
  updated: 'updated_at',
} as const

/** A collection's membership is manual pins UNION rule matches (see
 *  scoped-products.ts's own doc comment) — a collection like "Mesh Shorts"
 *  can be pure rules with zero rows in product_collections. Confirmed live:
 *  the admin Products page's collection filter used to check only
 *  product_collections and reported "No products found" for every
 *  rule-based collection, even ones with dozens of real active products
 *  matching their rule. Reuses the same cached rule-matching resolver the
 *  storefront/discounts/COD-restrictions already rely on, rather than a
 *  second, incomplete implementation of the same union. */
async function resolveCollectionProductIds(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  collectionId: string,
): Promise<string[]> {
  const { data: allProducts, error } = await admin.from('products').select('id')
  if (error) throw error
  const matched = await resolveCollectionScopedProductIds(
    admin,
    [collectionId],
    allProducts.map((p) => p.id),
  )
  // A collection with zero members would otherwise leave `.in('id', [])`
  // unfiltered (PostgREST treats an empty list as "no restriction"), which
  // would wrongly return every product instead of none — this placeholder
  // id can never match a real row.
  return matched.size
    ? Array.from(matched)
    : ['00000000-0000-0000-0000-000000000000']
}

const listAllProductsInputSchema = z.object({
  status: z.string().optional(),
  productType: z.string().optional(),
  q: z.string().optional(),
  collectionId: z.string().uuid().optional(),
  brand: z.enum(['spades', 'ysrael', 'aspire365']).optional(),
  sort: z
    .enum(['title', 'inventory', 'type', 'created', 'updated'])
    .default('created'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
})

export const listAllProducts = createServerFn({ method: 'GET' })
  .validator(listAllProductsInputSchema)
  .handler(async ({ data }): Promise<ProductWithCollectionNames[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    // 'inventory' sort resolves the correctly ordered/paginated id slice
    // first via admin_product_listing (which has a real total_stock column
    // to sort by), then fetches full nested rows for exactly those ids —
    // sorting the already-paginated `products` page client-side (the old
    // approach) only ever reordered whichever 50 rows happened to be the
    // 50 most-recently-created, so a high-stock older product could never
    // surface at all. Confirmed live: "Spades Denim Boxy Crop Tee" (222
    // in stock, the highest in the catalog) never appeared sorting
    // "Inventory: High to Low" because it was created 2026-07-14, well
    // outside the most-recent-50 the old query fetched.
    if (data.sort === 'inventory') {
      let stockQuery = admin.from('admin_product_listing').select('id')
      if (data.status) {
        stockQuery = stockQuery.eq('status', data.status as ProductStatus)
      }
      if (data.productType) {
        stockQuery = stockQuery.eq(
          'product_type',
          data.productType as ProductType,
        )
      }
      if (data.collectionId) {
        stockQuery = stockQuery.in(
          'id',
          await resolveCollectionProductIds(admin, data.collectionId),
        )
      }
      if (data.brand) stockQuery = stockQuery.eq('brand', data.brand)
      const search = data.q?.trim()
      if (search) {
        const normalizedSearch = normalizeSearchTerm(search)
        stockQuery = stockQuery.or(
          `name_search.ilike.%${normalizedSearch}%,slug.ilike.%${search}%`,
        )
      }
      stockQuery = stockQuery.order('total_stock', {
        ascending: data.dir === 'asc',
      })
      const offset = (data.page - 1) * data.pageSize
      const { data: idRows, error: idError } = await stockQuery.range(
        offset,
        offset + data.pageSize - 1,
      )
      if (idError) throw idError
      if (idRows.length === 0) return []

      const { data: products, error } = await admin
        .from('products')
        .select(
          '*, variants:product_variants(*, inventory(*)), collections:product_collections(collection_id, collection:collections(name))',
        )
        .in(
          'id',
          idRows.map((r) => r.id),
        )
      if (error) throw error

      // `.in()` doesn't preserve the order of the ids passed to it, so the
      // stock-based order resolved above has to be reapplied here.
      const orderById = new Map(idRows.map((r, i) => [r.id, i]))
      // Same hand-maintained-Database-type cast already needed by every
      // other `products` query in this file with this exact select shape
      // (this project's Relationships metadata is empty, so PostgREST's
      // embedded `collections` select can't be inferred correctly).
      return (products as unknown as ProductWithCollectionNames[]).sort(
        (a, b) => orderById.get(a.id)! - orderById.get(b.id)!,
      )
    }

    const sortColumn = SORT_COLUMNS[data.sort]

    let query = admin
      .from('products')
      .select(
        '*, variants:product_variants(*, inventory(*)), collections:product_collections(collection_id, collection:collections(name))',
      )
      .order(sortColumn, { ascending: data.dir === 'asc' })

    if (data.status) query = query.eq('status', data.status)
    if (data.productType) query = query.eq('product_type', data.productType)

    // Filtered via a separate lookup (rather than an inner-joined embed on
    // `collections`) so the `collections` field in the response still lists
    // every collection a matching product belongs to, not just the one
    // being filtered on.
    if (data.collectionId) {
      query = query.in(
        'id',
        await resolveCollectionProductIds(admin, data.collectionId),
      )
    }

    if (data.brand) query = query.eq('brand', data.brand)

    const search = data.q?.trim()
    if (search) {
      const normalizedSearch = normalizeSearchTerm(search)
      query = query.or(
        `name_search.ilike.%${normalizedSearch}%,slug.ilike.%${search}%`,
      )
    }

    const offset = (data.page - 1) * data.pageSize
    query = query.range(offset, offset + data.pageSize - 1)

    const { data: products, error } = await query
    if (error) throw error
    return products
  })

export const getProductsCount = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      status: z.string().optional(),
      productType: z.string().optional(),
      q: z.string().optional(),
      collectionId: z.string().uuid().optional(),
      brand: z.enum(['spades', 'ysrael', 'aspire365']).optional(),
    }),
  )
  .handler(async ({ data }): Promise<{ total: number }> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    let query = admin
      .from('products')
      .select('id', { count: 'exact', head: true })

    if (data.status) query = query.eq('status', data.status)
    if (data.productType) query = query.eq('product_type', data.productType)

    if (data.collectionId) {
      query = query.in(
        'id',
        await resolveCollectionProductIds(admin, data.collectionId),
      )
    }

    if (data.brand) query = query.eq('brand', data.brand)

    const search = data.q?.trim()
    if (search) {
      const normalizedSearch = normalizeSearchTerm(search)
      query = query.or(
        `name_search.ilike.%${normalizedSearch}%,slug.ilike.%${search}%`,
      )
    }

    const { count, error } = await query
    if (error) throw error
    return { total: count ?? 0 }
  })

export const getProductsByIds = createServerFn({ method: 'GET' })
  .validator(z.object({ ids: z.array(z.string().uuid()) }))
  .handler(async ({ data }): Promise<ProductWithCollectionNames[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const { data: products, error } = await admin
      .from('products')
      .select(
        '*, variants:product_variants(*, inventory(*)), collections:product_collections(collection_id, collection:collections(name))',
      )
      .in('id', data.ids)
      .order('created_at', { ascending: false })
      .order('sort_order', { foreignTable: 'variants' })
    if (error) throw error
    return products
  })

export const bulkUpdateProductStatus = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      productIds: z.array(z.string().uuid()),
      status: z.enum(['draft', 'active', 'archived']),
    }),
  )
  .handler(async ({ data }): Promise<void> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('products')
      .update({ status: data.status })
      .in('id', data.productIds)
    if (error) throw error

    await invalidateStorefrontListingCache()
    await invalidateProductDetailCache()
    await logStaffActivity(
      staff,
      'product.bulk_status_update',
      'products',
      null,
      {
        productIds: data.productIds,
        status: data.status,
      },
    )
  })

/**
 * Permanently deletes products (and, via `on delete cascade`, their
 * variants/collection memberships/marketplace mappings) — safe to do even
 * for products with order history, since order_items snapshots
 * product_name_snapshot/sku_snapshot/etc. at time of purchase and only
 * sets its variant_id to null (see 0001_init_schema.sql), so past orders
 * keep displaying correctly after the underlying product is gone.
 */
export const bulkDeleteProducts = createServerFn({ method: 'POST' })
  .validator(z.object({ productIds: z.array(z.string().uuid()) }))
  .handler(async ({ data }): Promise<void> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('products')
      .delete()
      .in('id', data.productIds)
    if (error) throw error

    await invalidateStorefrontListingCache()
    await invalidateProductDetailCache()
    await logStaffActivity(staff, 'product.bulk_delete', 'products', null, {
      productIds: data.productIds,
    })
  })

export interface ProductsOverview {
  range: { from: string; to: string }
  totalProducts: number
  activeProducts: number
  totalUnitsOnHand: number
  lowStockCount: number
  sellThroughRate: number | null
  daysOfInventory: { lowRunwayCount: number; hasVelocityData: boolean }
  abc: {
    hasSales: boolean
    aRevenueCents: number
    bRevenueCents: number
    cRevenueCents: number
  }
}

export const getProductsOverview = createServerFn({ method: 'GET' })
  .validator(z.object({ from: z.string(), to: z.string() }))
  .handler(async ({ data }): Promise<ProductsOverview> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const { start: rangeStart, end: rangeEnd } = storeRangeToUtcBounds(
      data.from,
      data.to,
    )
    const periodDays = Math.max(
      1,
      Math.round(
        (new Date(`${data.to}T00:00:00Z`).getTime() -
          new Date(`${data.from}T00:00:00Z`).getTime()) /
          86_400_000,
      ) + 1,
    )

    const [products, orders] = await Promise.all([
      admin
        .from('products')
        .select(
          'id, status, variants:product_variants(id, inventory(quantity_on_hand, low_stock_threshold))',
        ),
      admin
        .from('orders')
        .select('status, order_items(variant_id, quantity, line_total_cents)')
        .gte('placed_at', rangeStart)
        .lte('placed_at', rangeEnd),
    ])
    if (products.error) throw products.error
    if (orders.error) throw orders.error

    const variantToProduct = new Map<string, string>()
    const onHandByProduct = new Map<string, number>()
    let totalUnitsOnHand = 0
    let lowStockCount = 0

    for (const product of products.data) {
      let productOnHand = 0
      let productLow = false
      for (const variant of product.variants) {
        for (const inv of variant.inventory) {
          productOnHand += inv.quantity_on_hand
          if (inv.quantity_on_hand <= inv.low_stock_threshold) productLow = true
        }
        variantToProduct.set(variant.id, product.id)
      }
      onHandByProduct.set(product.id, productOnHand)
      totalUnitsOnHand += productOnHand
      if (productLow) lowStockCount += 1
    }

    const unitsSoldByProduct = new Map<string, number>()
    const revenueByProduct = new Map<string, number>()
    let totalUnitsSold = 0

    for (const order of orders.data) {
      if (order.status === 'cancelled' || order.status === 'failed') continue
      for (const item of order.order_items) {
        const productId = item.variant_id
          ? variantToProduct.get(item.variant_id)
          : undefined
        if (!productId) continue
        unitsSoldByProduct.set(
          productId,
          (unitsSoldByProduct.get(productId) ?? 0) + item.quantity,
        )
        revenueByProduct.set(
          productId,
          (revenueByProduct.get(productId) ?? 0) + item.line_total_cents,
        )
        totalUnitsSold += item.quantity
      }
    }

    const sellThroughRate =
      totalUnitsSold + totalUnitsOnHand > 0
        ? (totalUnitsSold / (totalUnitsSold + totalUnitsOnHand)) * 100
        : null

    let lowRunwayCount = 0
    for (const [productId, unitsSold] of unitsSoldByProduct) {
      const dailyVelocity = unitsSold / periodDays
      if (dailyVelocity <= 0) continue
      const onHand = onHandByProduct.get(productId) ?? 0
      const daysRemaining = onHand / dailyVelocity
      if (daysRemaining < 30) lowRunwayCount += 1
    }

    const revenues = Array.from(revenueByProduct.values()).sort((a, b) => b - a)
    const totalRevenue = revenues.reduce((sum, r) => sum + r, 0)
    let aRevenueCents = 0
    let bRevenueCents = 0
    let cRevenueCents = 0
    let cumulative = 0
    for (const rev of revenues) {
      cumulative += rev
      const cumulativePct = totalRevenue > 0 ? cumulative / totalRevenue : 0
      if (cumulativePct <= 0.8) aRevenueCents += rev
      else if (cumulativePct <= 0.95) bRevenueCents += rev
      else cRevenueCents += rev
    }

    return {
      range: { from: data.from, to: data.to },
      totalProducts: products.data.length,
      activeProducts: products.data.filter((p) => p.status === 'active').length,
      totalUnitsOnHand,
      lowStockCount,
      sellThroughRate,
      daysOfInventory: {
        lowRunwayCount,
        hasVelocityData: unitsSoldByProduct.size > 0,
      },
      abc: {
        hasSales: totalRevenue > 0,
        aRevenueCents,
        bRevenueCents,
        cRevenueCents,
      },
    }
  })

export const getProductById = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }): Promise<ProductWithDetails | null> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data: product, error } = await admin
      .from('products')
      .select(
        '*, variants:product_variants(*, inventory(*)), collections:product_collections(collection_id)',
      )
      .eq('id', data.id)
      .order('sort_order', { foreignTable: 'variants' })
      .maybeSingle()
    if (error) throw error
    return product
  })

export interface ProductSalesSummary {
  unitsSold: number
  revenueCents: number
}

export const getProductSalesSummary = createServerFn({ method: 'GET' })
  .validator(z.object({ productId: z.string().uuid() }))
  .handler(async ({ data }): Promise<ProductSalesSummary> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const { data: variants, error: variantsError } = await admin
      .from('product_variants')
      .select('id')
      .eq('product_id', data.productId)
    if (variantsError) throw variantsError

    const variantIds = variants.map((v) => v.id)
    if (variantIds.length === 0) return { unitsSold: 0, revenueCents: 0 }

    const { data: items, error } = await admin
      .from('order_items')
      .select('quantity, line_total_cents, order:orders(status)')
      .in('variant_id', variantIds)
    if (error) throw error

    let unitsSold = 0
    let revenueCents = 0
    for (const item of items) {
      if (item.order.status === 'cancelled' || item.order.status === 'failed')
        continue
      unitsSold += item.quantity
      revenueCents += item.line_total_cents
    }
    return { unitsSold, revenueCents }
  })

export const createProduct = createServerFn({ method: 'POST' })
  .validator(productInputSchema)
  .handler(async ({ data }): Promise<Product> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: product, error } = await admin
      .from('products')
      .insert({
        slug: data.slug,
        name: data.name,
        description: data.description ?? null,
        description_ja: data.descriptionJa ?? null,
        description_ko: data.descriptionKo ?? null,
        description_zh: data.descriptionZh ?? null,
        product_type: data.productType,
        status: data.status,
        brand: data.brand,
        images: data.images,
        tags: data.tags,
        seo_title: data.seoTitle ?? null,
        seo_description: data.seoDescription ?? null,
      })
      .select('*')
      .single()
    if (error) throw error

    await invalidateStorefrontListingCache()
    await logStaffActivity(staff, 'product.create', 'products', product.id, {
      slug: data.slug,
    })
    return product
  })

export const updateProduct = createServerFn({ method: 'POST' })
  .validator(updateProductSchema)
  .handler(async ({ data }): Promise<Product> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    // A duplicated product's variants start with a blank SKU (see
    // duplicateProduct) so staff type a real one instead of shipping an
    // auto-generated placeholder. Refuse to go active until every active
    // variant has one — sku_snapshot on order_items is NOT NULL, so a
    // customer buying a blank-SKU variant would fail to check out.
    if (data.status === 'active') {
      const { data: variants, error: variantsError } = await admin
        .from('product_variants')
        .select('sku')
        .eq('product_id', data.id)
        .eq('is_active', true)
      if (variantsError) throw variantsError
      if (variants.some((v) => !v.sku)) {
        throw new Error(
          'Every active variant needs a SKU before this product can go active — fill in the blank ones first.',
        )
      }
    }

    const { data: product, error } = await admin
      .from('products')
      .update({
        slug: data.slug,
        name: data.name,
        description: data.description ?? null,
        description_ja: data.descriptionJa ?? null,
        description_ko: data.descriptionKo ?? null,
        description_zh: data.descriptionZh ?? null,
        product_type: data.productType,
        status: data.status,
        brand: data.brand,
        images: data.images,
        tags: data.tags,
        seo_title: data.seoTitle ?? null,
        seo_description: data.seoDescription ?? null,
      })
      .eq('id', data.id)
      .select('*')
      .single()
    if (error) throw error

    await invalidateStorefrontListingCache()
    await invalidateProductDetailCache()
    await logStaffActivity(staff, 'product.update', 'products', product.id, {})
    return product
  })

async function uniqueSlug(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  base: string,
): Promise<string> {
  let candidate = base
  let n = 2
  for (;;) {
    const { data: existing } = await admin
      .from('products')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle<{ id: string }>()
    if (!existing) return candidate
    candidate = `${base}-${n}`
    n += 1
  }
}

/** Postgres reports SKU collisions as a raw "duplicate key value violates
 *  unique constraint" error with no mention of which SKU — rephrase it into
 *  something a staff member can act on. Other errors pass through as-is. */
function friendlySkuError(
  error: { code?: string; message: string },
  sku: string,
) {
  if (
    error.code === '23505' &&
    error.message.includes('product_variants_sku_key')
  ) {
    return new Error(`SKU "${sku}" is already used by another variant.`)
  }
  return error
}

/** Duplicates a product under a new title. Description, product type, status source, and collections always come along; images and variants (with their stock) are opt-in via checkboxes in the UI. */
export const duplicateProduct = createServerFn({ method: 'POST' })
  .validator(duplicateProductSchema)
  .handler(async ({ data }): Promise<Product> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: original, error: fetchError } = await admin
      .from('products')
      .select(
        '*, variants:product_variants(*, inventory(*)), collections:product_collections(collection_id)',
      )
      .eq('id', data.productId)
      .single()
    if (fetchError) throw fetchError

    const slug = await uniqueSlug(admin, slugify(data.newName))

    const { data: newProduct, error: insertError } = await admin
      .from('products')
      .insert({
        slug,
        name: data.newName,
        description: original.description,
        description_ja: original.description_ja,
        description_ko: original.description_ko,
        description_zh: original.description_zh,
        product_type: original.product_type,
        status: 'draft',
        brand: original.brand,
        images: data.duplicateImages ? original.images : [],
        tags: original.tags,
        seo_title: null,
        seo_description: null,
      })
      .select('*')
      .single()
    if (insertError) throw insertError

    if (original.collections.length > 0) {
      const { error: collectionsError } = await admin
        .from('product_collections')
        .insert(
          original.collections.map((c) => ({
            product_id: newProduct.id,
            collection_id: c.collection_id,
            sort_order: 0,
          })),
        )
      if (collectionsError) throw collectionsError

      await invalidateCollectionListingCache(
        original.collections.map((c) => c.collection_id),
      )
    }

    if (data.duplicateVariants) {
      // SKU is left blank (not an auto-generated "-copy" suffix) — staff
      // type a real one for each duplicated variant before it's ready to
      // sell (see the activation guard below, which refuses to let a
      // product go active with any blank SKU still on an active variant).
      // Safe to duplicate every variant concurrently since nothing here
      // depends on another variant's insert completing first.
      await Promise.all(
        original.variants.map(async (variant) => {
          const { data: newVariant, error: variantError } = await admin
            .from('product_variants')
            .insert({
              product_id: newProduct.id,
              sku: null,
              size: variant.size,
              color: variant.color,
              style: variant.style,
              sort_order: variant.sort_order,
              price_cents: variant.price_cents,
              compare_at_price_cents: variant.compare_at_price_cents,
              cost_cents: variant.cost_cents,
              weight_grams: variant.weight_grams,
              barcode: null,
              is_active: variant.is_active,
            })
            .select('*')
            .single()
          if (variantError) throw variantError

          const { error: inventoryError } = await admin
            .from('inventory')
            .insert({
              variant_id: newVariant.id,
              location_code: 'main',
              quantity_on_hand: variant.inventory[0]?.quantity_on_hand ?? 0,
            })
          if (inventoryError) throw inventoryError
        }),
      )
    }

    await logStaffActivity(
      staff,
      'product.duplicate',
      'products',
      newProduct.id,
      {
        sourceProductId: data.productId,
      },
    )
    return newProduct
  })

/**
 * Returns a short-lived signed upload URL so the browser can upload the
 * file directly to Supabase Storage instead of routing its bytes through
 * this server function. Base64-encoding a file and sending it as a
 * createServerFn body (the old approach) inflates its size by ~37% and
 * runs into Vercel's hard 4.5MB serverless request body cap — a photo
 * well under the 8MB client-side check would still get rejected as
 * "Request Entity Too Large" once base64-encoded (same issue fixed for
 * storefront section media — see server/admin/storefront-sections.ts's
 * createStorefrontSectionUploadUrl). The signed token is what gates the
 * upload (only issued after requireStaff passes), not a public
 * bucket-write policy.
 */
export const createProductImageUploadUrl = createServerFn({
  method: 'POST',
})
  .validator(productImageUploadUrlSchema)
  .handler(
    async ({
      data,
    }): Promise<{ path: string; token: string; publicUrl: string }> => {
      await requireStaff(MANAGE_ROLES)
      const admin = getSupabaseAdminClient()

      const extension = data.fileName.includes('.')
        ? data.fileName.split('.').pop()
        : 'jpg'
      const path = `${randomUUID()}.${extension}`

      const { data: signed, error } = await admin.storage
        .from('product-images')
        .createSignedUploadUrl(path)
      if (error) throw error

      const { data: publicUrl } = admin.storage
        .from('product-images')
        .getPublicUrl(path)

      return { path, token: signed.token, publicUrl: publicUrl.publicUrl }
    },
  )

export const createVariant = createServerFn({ method: 'POST' })
  .validator(variantInputSchema)
  .handler(async ({ data }): Promise<ProductVariant> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { count: existingCount, error: countError } = await admin
      .from('product_variants')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', data.productId)
    if (countError) throw countError

    const { data: variant, error } = await admin
      .from('product_variants')
      .insert({
        product_id: data.productId,
        sku: data.sku,
        size: data.size ?? null,
        color: data.color ?? null,
        style: data.style ?? null,
        price_cents: pesosToCents(data.pricePesos),
        compare_at_price_cents:
          data.compareAtPricePesos !== undefined
            ? pesosToCents(data.compareAtPricePesos)
            : null,
        cost_cents:
          data.costPesos !== undefined ? pesosToCents(data.costPesos) : null,
        ab_cost_cents:
          data.abCostPesos !== undefined
            ? pesosToCents(data.abCostPesos)
            : null,
        weight_grams: data.weightGrams ?? null,
        barcode: data.barcode ?? null,
        is_active: data.isActive,
        sort_order: existingCount ?? 0,
      })
      .select('*')
      .single()
    if (error) throw friendlySkuError(error, data.sku)

    const { error: inventoryError } = await admin.from('inventory').insert({
      variant_id: variant.id,
      location_code: 'main',
      quantity_on_hand: 0,
    })
    if (inventoryError) throw inventoryError

    await invalidateStorefrontListingCache()
    await invalidateProductDetailCache()
    await logStaffActivity(
      staff,
      'variant.create',
      'product_variants',
      variant.id,
      { sku: data.sku },
    )
    return variant
  })

export const reorderVariants = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      productId: z.string().uuid(),
      orderedVariantIds: z.array(z.string().uuid()),
    }),
  )
  .handler(async ({ data }): Promise<void> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const results = await Promise.all(
      data.orderedVariantIds.map((id, index) =>
        admin
          .from('product_variants')
          .update({ sort_order: index })
          .eq('id', id)
          .eq('product_id', data.productId),
      ),
    )
    const failed = results.find((r) => r.error)
    if (failed?.error) throw failed.error

    // Variant order is part of what a cached product-detail page shows
    // (resolveProductBySlug orders variants by sort_order) — the listing
    // page never shows per-variant order, so only the detail cache needs
    // clearing here.
    await invalidateProductDetailCache()
    await logStaffActivity(
      staff,
      'variant.reorder',
      'products',
      data.productId,
      { count: data.orderedVariantIds.length },
    )
  })

export const updateVariant = createServerFn({ method: 'POST' })
  .validator(updateVariantSchema)
  .handler(async ({ data }): Promise<ProductVariant> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: variant, error } = await admin
      .from('product_variants')
      .update({
        sku: data.sku || null,
        size: data.size ?? null,
        color: data.color ?? null,
        style: data.style ?? null,
        price_cents: pesosToCents(data.pricePesos),
        compare_at_price_cents:
          data.compareAtPricePesos !== undefined
            ? pesosToCents(data.compareAtPricePesos)
            : null,
        cost_cents:
          data.costPesos !== undefined ? pesosToCents(data.costPesos) : null,
        ab_cost_cents:
          data.abCostPesos !== undefined
            ? pesosToCents(data.abCostPesos)
            : null,
        weight_grams: data.weightGrams ?? null,
        barcode: data.barcode ?? null,
        is_active: data.isActive,
      })
      .eq('id', data.id)
      .select('*')
      .single()
    if (error) throw friendlySkuError(error, data.sku)

    await invalidateStorefrontListingCache()
    await invalidateProductDetailCache()
    await logStaffActivity(
      staff,
      'variant.update',
      'product_variants',
      variant.id,
      {},
    )
    return variant
  })

/** Narrow partial update for the Inventory page's quick-edit row — only touches sku/cost, unlike updateVariant which replaces every field. */
export const updateVariantQuickEdit = createServerFn({ method: 'POST' })
  .validator(quickEditVariantSchema)
  .handler(async ({ data }): Promise<ProductVariant> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: variant, error } = await admin
      .from('product_variants')
      .update({
        sku: data.sku || null,
        cost_cents:
          data.costPesos !== undefined
            ? pesosToCents(data.costPesos)
            : undefined,
        ab_cost_cents:
          data.abCostPesos !== undefined
            ? pesosToCents(data.abCostPesos)
            : undefined,
      })
      .eq('id', data.id)
      .select('*')
      .single()
    if (error) throw friendlySkuError(error, data.sku)

    await logStaffActivity(
      staff,
      'variant.quick_edit',
      'product_variants',
      variant.id,
      {},
    )
    return variant
  })

export interface ProductPickerResult {
  id: string
  name: string
  slug: string
  image: string | null
}

export const searchProductsForPicker = createServerFn({ method: 'GET' })
  .validator(z.object({ q: z.string().optional() }))
  .handler(async ({ data }): Promise<ProductPickerResult[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    let query = admin
      .from('products')
      .select('id, name, slug, images')
      .order('name', { ascending: true })
      .limit(50)

    const search = data.q?.trim()
    if (search) {
      const normalizedSearch = normalizeSearchTerm(search)
      query = query.or(
        `name_search.ilike.%${normalizedSearch}%,slug.ilike.%${search}%`,
      )
    }

    const { data: products, error } = await query
    if (error) throw error
    return products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      image: p.images[0] ?? null,
    }))
  })

export interface OrderEditVariantOption {
  id: string
  label: string
  sku: string | null
  priceCents: number
  isActive: boolean
  quantityAvailable: number
}

/** A product's variants for the admin order-items editor's "add item"/
 *  "change size" picker (see components/admin/OrderItemsEditor.tsx) — needs
 *  price + stock + active state up front so staff can see what's actually
 *  available before picking, not just a bare list of sizes. */
export const getVariantsForOrderEdit = createServerFn({ method: 'GET' })
  .validator(z.object({ productId: z.string().uuid() }))
  .handler(async ({ data }): Promise<OrderEditVariantOption[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const { data: variants, error } = await admin
      .from('product_variants')
      .select(
        'id, sku, size, color, style, price_cents, is_active, inventory(quantity_available)',
      )
      .eq('product_id', data.productId)
    if (error) throw error

    return variants.map((v) => ({
      id: v.id,
      label:
        [v.size, v.color, v.style].filter(Boolean).join(' / ') || 'Default',
      sku: v.sku,
      priceCents: v.price_cents,
      isActive: v.is_active,
      quantityAvailable: v.inventory.reduce(
        (sum, i) => sum + i.quantity_available,
        0,
      ),
    }))
  })

export const setProductCollections = createServerFn({ method: 'POST' })
  .validator(setProductCollectionsSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    // Captured before the delete below so invalidation covers collections
    // the product is LEAVING too, not just the ones it's joining — both
    // sides' cached listing (fetchCollectionListingScope) become stale.
    const { data: previousRows, error: previousError } = await admin
      .from('product_collections')
      .select('collection_id')
      .eq('product_id', data.productId)
    if (previousError) throw previousError
    const previousCollectionIds = previousRows.map((r) => r.collection_id)
    const nextCollectionIds = new Set(data.collectionIds)

    // Only touch rows for collections actually being left or joined — each
    // collection's own edit page lets staff drag products into a specific
    // order (sort_order), persisted per (product_id, collection_id). Wiping
    // and reinserting every row here (as this used to do) reset that order
    // to "index among the collections checked on THIS form" every time any
    // unrelated field on the product was saved, silently undoing drag work
    // done on the collection page.
    const removedCollectionIds = previousCollectionIds.filter(
      (id) => !nextCollectionIds.has(id),
    )
    const addedCollectionIds = data.collectionIds.filter(
      (id) => !previousCollectionIds.includes(id),
    )

    if (removedCollectionIds.length > 0) {
      const { error: deleteError } = await admin
        .from('product_collections')
        .delete()
        .eq('product_id', data.productId)
        .in('collection_id', removedCollectionIds)
      if (deleteError) throw deleteError
    }

    if (addedCollectionIds.length > 0) {
      // Append each newly-joined collection at the end of its own existing
      // order, same as addProductToCollection — never interleaved into the
      // middle of an order staff already set by hand.
      const maxSortOrders = await Promise.all(
        addedCollectionIds.map(async (collectionId) => {
          const { data: existing, error: maxError } = await admin
            .from('product_collections')
            .select('sort_order')
            .eq('collection_id', collectionId)
            .order('sort_order', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (maxError) throw maxError
          return (existing?.sort_order ?? -1) + 1
        }),
      )

      const { error: insertError } = await admin
        .from('product_collections')
        .insert(
          addedCollectionIds.map((collectionId, index) => ({
            product_id: data.productId,
            collection_id: collectionId,
            sort_order: maxSortOrders[index],
          })),
        )
      if (insertError) throw insertError
    }

    await invalidateCollectionListingCache([
      ...new Set([...previousCollectionIds, ...data.collectionIds]),
    ])

    await logStaffActivity(
      staff,
      'product.set_collections',
      'products',
      data.productId,
      {
        collectionIds: data.collectionIds,
      },
    )
    return { ok: true }
  })

export const adjustInventory = createServerFn({ method: 'POST' })
  .validator(inventoryAdjustmentSchema)
  .handler(async ({ data }): Promise<Inventory> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: current, error: readError } = await admin
      .from('inventory')
      .select('*')
      .eq('variant_id', data.variantId)
      .eq('location_code', 'main')
      .single()
    if (readError) throw readError

    const { data: updated, error: updateError } = await admin
      .from('inventory')
      .update({
        quantity_on_hand: current.quantity_on_hand + data.quantityDelta,
      })
      .eq('id', current.id)
      .select('*')
      .single()
    if (updateError) {
      // inventory_reserved_le_on_hand (0001_init_schema.sql:213) blocks
      // dropping on-hand below what's already reserved by an active
      // cart/checkout for this variant. The admin UI only ever asks staff
      // to edit *available* stock now (QuantityEditor computes this same
      // delta from a desired available quantity), which keeps this
      // constraint satisfied by construction as long as the target is >= 0
      // — so hitting it here means reserved grew between page load and
      // save (someone else just added/checked out with this variant).
      if (
        updateError.code === '23514' &&
        updateError.message.includes('inventory_reserved_le_on_hand')
      ) {
        throw new Error(
          "Can't save — the number reserved in active carts/checkouts for this variant changed since the page loaded. Refresh and try again.",
        )
      }
      throw updateError
    }

    const { error: movementError } = await admin
      .from('inventory_movements')
      .insert({
        variant_id: data.variantId,
        location_code: 'main',
        movement_type: data.quantityDelta > 0 ? 'purchase_in' : 'adjustment',
        quantity_delta: data.quantityDelta,
        note: data.note ?? null,
        created_by: staff.auth_user_id,
      })
    if (movementError) throw movementError

    await invalidateStorefrontListingCache()
    await invalidateProductDetailCache()
    await logStaffActivity(staff, 'inventory.adjust', 'inventory', updated.id, {
      variantId: data.variantId,
      delta: data.quantityDelta,
      // The on-hand quantity right after this specific edit — not derivable
      // from today's current stock minus delta later, since a sale/return
      // can move stock again afterward without ever going through a staff
      // activity log of its own (see LastUpdatedBadge's stock-change tooltip).
      newQuantity: updated.quantity_on_hand,
    })

    // Awaited (not fire-and-forget) — on serverless, work kicked off after
    // the response is sent isn't guaranteed to finish. A marketplace being
    // down/rate-limited still shouldn't fail the actual stock adjustment
    // though — pushInventoryForVariant already logs its own success/failure
    // to sync_logs and retries with backoff, so swallow the error here.
    await pushInventoryForVariant(data.variantId).catch(() => {})

    return updated
  })

/**
 * Logs a restock — always a positive addition to on-hand stock, always
 * movement_type 'purchase_in', with a staff-chosen date (see restockSchema's
 * own comment on why that's a separate field from created_at). Shares
 * adjustInventory's on-hand update, just without that function's
 * negative-delta branch — a pure addition can never trip the
 * inventory_reserved_le_on_hand constraint, so there's nothing to catch here.
 */
export const recordRestock = createServerFn({ method: 'POST' })
  .validator(restockSchema)
  .handler(async ({ data }): Promise<Inventory> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: current, error: readError } = await admin
      .from('inventory')
      .select('*')
      .eq('variant_id', data.variantId)
      .eq('location_code', 'main')
      .single()
    if (readError) throw readError

    const { data: updated, error: updateError } = await admin
      .from('inventory')
      .update({ quantity_on_hand: current.quantity_on_hand + data.quantity })
      .eq('id', current.id)
      .select('*')
      .single()
    if (updateError) throw updateError

    const { error: movementError } = await admin
      .from('inventory_movements')
      .insert({
        variant_id: data.variantId,
        location_code: 'main',
        movement_type: 'purchase_in',
        quantity_delta: data.quantity,
        occurred_at: data.occurredAt,
        note: data.note ?? null,
        created_by: staff.auth_user_id,
      })
    if (movementError) throw movementError

    await invalidateStorefrontListingCache()
    await invalidateProductDetailCache()
    await logStaffActivity(
      staff,
      'inventory.restock',
      'inventory',
      updated.id,
      {
        variantId: data.variantId,
        quantity: data.quantity,
        occurredAt: data.occurredAt,
        newQuantity: updated.quantity_on_hand,
      },
    )

    await pushInventoryForVariant(data.variantId).catch(() => {})

    return updated
  })

export interface RestockRow {
  productId: string
  productName: string
  productImage: string | null
  /** YYYY-MM-DD — the movements' own occurred_at when staff set one via the
   *  Restock flow, else the date logged (created_at), covering 'purchase_in'
   *  rows written by the older generic adjustInventory path too (see that
   *  function's own comment) — every stock-in event feeds into this
   *  regardless of which UI entry point logged it. */
  restockedAt: string
  /** Summed across every variant restocked for this product on this date —
   *  see RESTOCK_MIN_TOTAL_QUANTITY's own comment on why the threshold
   *  below is evaluated at this whole-product level, not per variant. */
  quantityAdded: number
  /** Current stock summed across exactly the variants restocked in this
   *  event — not every variant the product has (an untouched variant's
   *  stock has nothing to do with what THIS restock sold through). Shown
   *  as a current-stock figure; quantitySold below is NOT derived from
   *  this (see its own comment on why that used to be the bug). */
  currentQuantityAvailable: number
  /** Real units sold since this restock — summed straight from the
   *  sale_committed ledger (inventory_movements) for these exact variants,
   *  after this restock's own timestamp, not derived from current stock.
   *
   *  Used to be `max(0, quantityAdded - currentQuantityAvailable)`, which
   *  silently broke (usually under-reporting, sometimes flooring to 0
   *  despite real sales) whenever anything else touched these variants'
   *  stock after the restock: a return, a later restock/recount, a
   *  marketplace sync adjustment, or — the common case — the restock
   *  simply topping up shelves that weren't at zero to begin with (that
   *  leftover baseline stock was never subtracted, so it read as
   *  unsold). The ledger sum has none of those failure modes.
   *
   *  Still an approximation only when the SAME variant was restocked more
   *  than once in quick succession — an earlier restock's window and a
   *  later one's can overlap, so a sale after the later restock may get
   *  counted under both. Fine for "sold 18 in 28 days" at a glance. */
  quantitySold: number
  variantCount: number
}

const RESTOCKS_PAGE_SIZE_DEFAULT = 50

/** Staff recounting stock (correcting a miscounted size) also writes a
 *  positive purchase_in movement, same as a real restock — indistinguishable
 *  at the single-row level. Confirmed live: this shop's actual data cleanly
 *  separates into ~1-9 unit single-variant corrections and 50-300+ unit
 *  multi-variant restocks, nothing in between — so a genuine bulk restock's
 *  same-day, whole-product total reliably clears this threshold while a
 *  recount's correction essentially never does. Evaluated per (product,
 *  date), summing every variant restocked that day — never per individual
 *  variant, since a real restock split across six sizes (e.g. +9/+32/+38/
 *  +30/+12/+2) would otherwise have each row look small on its own.
 *  Exported so the LIVE Product Planner's "recently restocked" signal
 *  (server/admin/live-planner.ts) uses this exact same threshold rather
 *  than risking a second, silently-drifting definition of "a real
 *  restock." */
export const RESTOCK_MIN_TOTAL_QUANTITY = 50

// Keeps every .in() id-list query below well under PostgREST's request-URL
// length limit — see computeRestockGroups' own comment on the crash this
// fixes. Same conservative ballpark as SEARCH_ID_CHUNK_SIZE elsewhere
// (server/admin/orders.ts), sized down a bit since these ids are UUIDs
// (36 chars each) rather than that file's shorter ones.
const RESTOCK_ID_CHUNK_SIZE = 150

interface RestockGroup {
  productId: string
  productName: string
  productImage: string | null
  restockedAt: string
  quantityAdded: number
  variantIds: Set<string>
  /** Latest created_at among this group's own purchase_in rows — the cutoff
   *  used below to find sale_committed movements that happened after this
   *  restock, rather than before it. */
  lastMovementAt: string
}

/** Shared by listRestocks/getRestocksCount so they group and threshold
 *  identically — see RestockRow/RESTOCK_MIN_TOTAL_QUANTITY's own comments.
 *  Re-run per call rather than cached: at this shop's current ~700-row
 *  purchase_in volume, a full recompute is cheap, and a restock/recount
 *  just logged should show up immediately, not after some TTL. */
async function computeRestockGroups(
  admin: ReturnType<typeof getSupabaseAdminClient>,
): Promise<RestockRow[]> {
  const movements = await fetchAllRows<{
    variant_id: string
    quantity_delta: number
    occurred_at: string | null
    created_at: string
  }>((offset) =>
    admin
      .from('inventory_movements')
      .select('variant_id, quantity_delta, occurred_at, created_at')
      .eq('movement_type', 'purchase_in')
      .range(offset, offset + 999),
  )
  if (movements.length === 0) return []

  // inventory_movements has no declared Relationships metadata (unlike
  // product_variants, an older table that does) — embedding products/
  // inventory off product_variants instead, same pattern stock-audit.ts
  // already relies on, rather than a broken embed here. Fetched once,
  // covering both what each variant belongs to AND what it has in stock
  // right now — no second query needed for current quantity.
  //
  // Chunked — this shop already has ~700 purchase_in rows, and a single
  // .in() with every one of their (up to that many) distinct variant ids
  // built a ~18,000-character request URL that blew past Supabase's HTTP
  // header size limit (confirmed live: crashed the whole admin app with an
  // uncaught HeadersOverflowError, not just this page) — the same class of
  // bug this codebase has hit before with a large .in() list elsewhere
  // (see resolveSearchMatchedOrderIds in server/admin/orders.ts).
  const variantIds = Array.from(new Set(movements.map((m) => m.variant_id)))
  const variantChunks = await Promise.all(
    chunkArray(variantIds, RESTOCK_ID_CHUNK_SIZE).map(async (chunk) => {
      const { data, error } = await admin
        .from('product_variants')
        .select(
          'id, product:products(id, name, images), inventory(quantity_available)',
        )
        .in('id', chunk)
      if (error) throw error
      return data
    }),
  )
  const variantById = new Map(variantChunks.flat().map((v) => [v.id, v]))

  const groups = new Map<string, RestockGroup>()
  for (const m of movements) {
    const variant = variantById.get(m.variant_id)
    // A variant/product deleted after the movement was logged (cascades per
    // 0001_init_schema.sql's foreign keys) has nothing left to join —
    // skipped, since the restock can no longer be acted on anyway.
    if (!variant) continue
    const restockedAt = m.occurred_at ?? m.created_at.slice(0, 10)
    const key = `${variant.product.id}:${restockedAt}`
    const existing = groups.get(key)
    if (existing) {
      existing.quantityAdded += m.quantity_delta
      existing.variantIds.add(variant.id)
      if (m.created_at > existing.lastMovementAt) {
        existing.lastMovementAt = m.created_at
      }
    } else {
      groups.set(key, {
        productId: variant.product.id,
        productName: variant.product.name,
        productImage: variant.product.images[0] ?? null,
        restockedAt,
        quantityAdded: m.quantity_delta,
        variantIds: new Set([variant.id]),
        lastMovementAt: m.created_at,
      })
    }
  }

  const restockGroups = Array.from(groups.values()).filter(
    (g) => g.quantityAdded >= RESTOCK_MIN_TOTAL_QUANTITY,
  )

  // Real "sold since restock" has to come from the sale ledger, not from
  // current stock (see quantitySold's own comment) — fetched only for
  // variants that actually appear in a real restock above, chunked the
  // same way as the product/inventory lookup above and for the same
  // reason (a large .in() list can blow past PostgREST's URL limit).
  // Paginated per chunk too — this shop already has ~9,000 sale_committed
  // rows total, so an unbounded select here hits PostgREST's default
  // 1000-row cap and silently truncates (confirmed live: a variant with
  // real sales after its restock read back as having none, since all of
  // its rows happened to fall past row 1000 in whatever order Postgres
  // returned them) — the exact bug fetchAllRows exists to prevent.
  const restockedVariantIds = Array.from(
    new Set(restockGroups.flatMap((g) => Array.from(g.variantIds))),
  )
  const saleMovementChunks = await Promise.all(
    chunkArray(restockedVariantIds, RESTOCK_ID_CHUNK_SIZE).map((chunk) =>
      fetchAllRows<{
        variant_id: string
        quantity_delta: number
        created_at: string
      }>((offset) =>
        admin
          .from('inventory_movements')
          .select('variant_id, quantity_delta, created_at')
          .eq('movement_type', 'sale_committed')
          .in('variant_id', chunk)
          .range(offset, offset + 999),
      ),
    ),
  )
  const saleMovementsByVariant = new Map<
    string,
    { quantityDelta: number; createdAt: string }[]
  >()
  for (const row of saleMovementChunks.flat()) {
    const list = saleMovementsByVariant.get(row.variant_id) ?? []
    list.push({ quantityDelta: row.quantity_delta, createdAt: row.created_at })
    saleMovementsByVariant.set(row.variant_id, list)
  }

  return restockGroups
    .map((g) => {
      // Summed from the Set of distinct variant ids, not accumulated per
      // movement row above — a variant touched by two separate movements
      // the same day (e.g. a restock immediately followed by a same-day
      // recount) would otherwise have its current stock double-counted.
      const currentQuantityAvailable = Array.from(g.variantIds).reduce(
        (sum, id) =>
          sum + (variantById.get(id)?.inventory.at(0)?.quantity_available ?? 0),
        0,
      )
      const quantitySold = Array.from(g.variantIds).reduce((sum, id) => {
        const sales = saleMovementsByVariant.get(id) ?? []
        const soldForVariant = sales
          .filter((s) => s.createdAt > g.lastMovementAt)
          .reduce((s, sale) => s - sale.quantityDelta, 0)
        return sum + soldForVariant
      }, 0)
      return {
        productId: g.productId,
        productName: g.productName,
        productImage: g.productImage,
        restockedAt: g.restockedAt,
        quantityAdded: g.quantityAdded,
        currentQuantityAvailable,
        quantitySold,
        variantCount: g.variantIds.size,
      }
    })
    .sort((a, b) => b.restockedAt.localeCompare(a.restockedAt))
}

export const listRestocks = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(RESTOCKS_PAGE_SIZE_DEFAULT),
    }),
  )
  .handler(async ({ data }): Promise<RestockRow[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const groups = await computeRestockGroups(admin)
    const offset = (data.page - 1) * data.pageSize
    return groups.slice(offset, offset + data.pageSize)
  })

export const getRestocksCount = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ total: number }> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const groups = await computeRestockGroups(admin)
    return { total: groups.length }
  },
)

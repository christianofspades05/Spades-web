import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { collectionRuleSchema, matchesRules } from '#/lib/collections/rules'
import {
  setCategoryDefaultSchema,
  deleteCategoryDefaultSchema,
} from '#/lib/validation/admin/marketplace-category-defaults'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { logStaffActivity } from './activity-log'
import { IMPLEMENTED_MARKETPLACES } from '#/server/integrations/marketplaces/registry'
import {
  autoConnectProductsByTitle,
  autoConnectProductsBySku,
  connectExistingProductToMarketplace,
  getCategoryAttributesForMarketplace,
  listCategoriesForMarketplace,
  pullOrdersForMarketplace,
  pullReturnsForMarketplace,
  pushInventoryForAllProducts,
  pushInventoryForProducts,
  pushInventoryForVariant,
  pushNewProductToMarketplace,
  pushPriceForAllProducts,
  pushPriceForProducts,
  revalidateAllMappedProducts,
  revalidateMapping,
} from '#/server/integrations/marketplaces/sync-engine'
import type {
  AutoConnectByTitleResult,
  AutoConnectBySkuResult,
  RevalidateMappingsResult,
} from '#/server/integrations/marketplaces/sync-engine'
import type {
  MarketplaceCategory,
  MarketplaceCategoryAttribute,
  MarketplaceCategoryAttributeAnswer,
} from '#/server/integrations/marketplaces/types'
import type {
  MarketplaceConnection,
  MarketplaceName,
  StaffRole,
} from '#/types/entities'
import type { ProductType } from '#/types/database.types'

const MANAGE_ROLES: StaffRole[] = ['super_admin', 'admin']

const marketplaceSchema = z.enum(['tiktok_shop', 'shopee', 'lazada'])

export interface ChannelConnectionInfo {
  marketplace: MarketplaceName
  implemented: boolean
  connection: MarketplaceConnection | null
}

export const listChannelConnections = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ChannelConnectionInfo[]> => {
    await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: connections, error } = await admin
      .from('marketplace_connections')
      .select('*')
    if (error) throw error

    const allMarketplaces: MarketplaceName[] = [
      'tiktok_shop',
      'shopee',
      'lazada',
    ]
    return allMarketplaces.map((marketplace) => ({
      marketplace,
      implemented: IMPLEMENTED_MARKETPLACES.includes(marketplace),
      connection:
        connections.find((c) => c.marketplace === marketplace) ?? null,
    }))
  },
)

export const disconnectChannel = createServerFn({ method: 'POST' })
  .validator(z.object({ marketplace: marketplaceSchema }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('marketplace_connections')
      .update({ status: 'revoked' })
      .eq('marketplace', data.marketplace)
    if (error) throw error

    await logStaffActivity(
      staff,
      'channel.disconnect',
      'marketplace_connections',
      null,
      { marketplace: data.marketplace },
    )
    return { ok: true }
  })

/**
 * Inventory sync is off by default (see sync-engine.ts's pushOneMapping
 * comment on why) — turning it on here also immediately pushes every
 * currently-connected product's stock once, so enabling isn't a silent
 * no-op until the next scheduled sync.
 */
export const setInventorySyncEnabled = createServerFn({ method: 'POST' })
  .validator(z.object({ marketplace: marketplaceSchema, enabled: z.boolean() }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('marketplace_connections')
      .update({ inventory_sync_enabled: data.enabled })
      .eq('marketplace', data.marketplace)
    if (error) throw error

    await logStaffActivity(
      staff,
      'channel.set_inventory_sync_enabled',
      'marketplace_connections',
      null,
      { marketplace: data.marketplace, enabled: data.enabled },
    )

    if (data.enabled) {
      await pushInventoryForAllProducts(data.marketplace)
    }

    return { ok: true }
  })

/**
 * Price sync is off by default, same reasoning as inventory sync above —
 * turning it on immediately pushes every currently-connected product's
 * price once too.
 */
export const setPriceSyncEnabled = createServerFn({ method: 'POST' })
  .validator(z.object({ marketplace: marketplaceSchema, enabled: z.boolean() }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('marketplace_connections')
      .update({ price_sync_enabled: data.enabled })
      .eq('marketplace', data.marketplace)
    if (error) throw error

    await logStaffActivity(
      staff,
      'channel.set_price_sync_enabled',
      'marketplace_connections',
      null,
      { marketplace: data.marketplace, enabled: data.enabled },
    )

    if (data.enabled) {
      await pushPriceForAllProducts(data.marketplace)
    }

    return { ok: true }
  })

/**
 * How much higher this channel's regular (non-sale) price sits above the
 * website's own base price — e.g. Shopee listings run 10% above the
 * website. Used by pushPriceForAllProducts to compute what a storefront
 * sale should push as this channel's price, since the raw website price
 * would undercut by the markup amount. Re-pushes prices immediately if sync
 * is already enabled, same "not a silent no-op" reasoning as the toggle.
 */
export const setPriceMarkupPercent = createServerFn({ method: 'POST' })
  .validator(
    z.object({ marketplace: marketplaceSchema, markupPercent: z.number().min(0) }),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: connection, error } = await admin
      .from('marketplace_connections')
      .update({ price_markup_percent: data.markupPercent })
      .eq('marketplace', data.marketplace)
      .select('price_sync_enabled')
      .single()
    if (error) throw error

    await logStaffActivity(
      staff,
      'channel.set_price_markup_percent',
      'marketplace_connections',
      null,
      { marketplace: data.marketplace, markupPercent: data.markupPercent },
    )

    if (connection.price_sync_enabled) {
      await pushPriceForAllProducts(data.marketplace)
    }

    return { ok: true }
  })

export interface ProductSyncRow {
  variantId: string
  productId: string
  productName: string
  productImage: string | null
  productCreatedAt: string
  productType: ProductType
  sku: string | null
  size: string | null
  color: string | null
  style: string | null
  quantityAvailable: number
  mapping: {
    id: string
    externalVariantId: string | null
    externalSku: string | null
    syncStatus: 'synced' | 'pending' | 'error'
    lastSyncedAt: string | null
  } | null
}

/**
 * Resolves which products belong to a collection the same way the
 * storefront does (see listActiveProducts in src/server/products/queries.ts)
 * — manually pinned products (product_collections) always count, plus
 * whatever else currently matches the collection's rules, since a "smart"
 * collection's membership isn't stored anywhere, only computed on read.
 */
async function resolveCollectionProductIds(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  collectionId: string,
): Promise<Set<string>> {
  const { data: collection, error: collectionError } = await admin
    .from('collections')
    .select('match_type, rules, hide_out_of_stock_products')
    .eq('id', collectionId)
    .single()
  if (collectionError) throw collectionError

  const [{ data: products, error: productsError }, { data: memberships }] =
    await Promise.all([
      admin
        .from('products')
        .select(
          'id, name, product_type, status, tags, variants:product_variants(price_cents, inventory(quantity_available))',
        )
        .eq('status', 'active'),
      admin
        .from('product_collections')
        .select('product_id')
        .eq('collection_id', collectionId),
    ])
  if (productsError) throw productsError

  const pinnedIds = new Set((memberships ?? []).map((m) => m.product_id))
  const rules = z.array(collectionRuleSchema).parse(collection.rules)

  const matched = new Set<string>(pinnedIds)
  for (const p of products) {
    if (pinnedIds.has(p.id)) continue
    const inventoryStock = p.variants.reduce(
      (sum, v) =>
        sum + v.inventory.reduce((s, i) => s + i.quantity_available, 0),
      0,
    )
    const prices = p.variants.map((v) => v.price_cents)
    const lowestPriceCents = prices.length > 0 ? Math.min(...prices) : null
    if (
      matchesRules(
        {
          name: p.name,
          productType: p.product_type,
          status: p.status,
          tags: p.tags,
          inventoryStock,
          lowestPriceCents,
        },
        rules,
        collection.match_type,
      )
    ) {
      if (!collection.hide_out_of_stock_products || inventoryStock > 0) {
        matched.add(p.id)
      }
    }
  }

  return matched
}

export const listProductSyncStatus = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      marketplace: marketplaceSchema,
      collectionId: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data }): Promise<ProductSyncRow[]> => {
    await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: connection } = await admin
      .from('marketplace_connections')
      .select('id')
      .eq('marketplace', data.marketplace)
      .maybeSingle()

    // Supabase/PostgREST caps a single response at 1000 rows by default —
    // with 1000+ active variants in the catalog, an unpaginated query
    // silently truncated (ordered by sku, so anything sorting past the
    // cutoff just never came back). Page through everything explicitly.
    const PAGE_SIZE = 1000
    const variants: {
      id: string
      sku: string | null
      size: string | null
      color: string | null
      style: string | null
      product: {
        id: string
        name: string
        images: string[]
        created_at: string
        product_type: ProductType
      }
      inventory: { quantity_available: number }[]
    }[] = []
    for (let page = 0; ; page++) {
      const { data: batch, error } = await admin
        .from('product_variants')
        .select(
          'id, sku, size, color, style, product:products(id, name, images, created_at, product_type), inventory(quantity_available)',
        )
        .eq('is_active', true)
        .order('sku', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      if (error) throw error
      variants.push(...batch)
      if (batch.length < PAGE_SIZE) break
    }

    const { data: mappings } = connection
      ? await admin
          .from('marketplace_product_mappings')
          .select(
            'id, variant_id, external_variant_id, external_sku, sync_status, last_synced_at',
          )
          .eq('marketplace_connection_id', connection.id)
      : { data: [] }
    const mappingByVariantId = new Map(
      (mappings ?? []).map((m) => [m.variant_id, m]),
    )

    const allowedProductIds = data.collectionId
      ? await resolveCollectionProductIds(admin, data.collectionId)
      : null

    return variants
      .filter((v) => !allowedProductIds || allowedProductIds.has(v.product.id))
      .map((v) => {
        const mapping = mappingByVariantId.get(v.id)
        return {
          variantId: v.id,
          productId: v.product.id,
          productName: v.product.name,
          productImage: v.product.images[0] ?? null,
          productCreatedAt: v.product.created_at,
          productType: v.product.product_type,
          sku: v.sku,
          size: v.size,
          color: v.color,
          style: v.style,
          quantityAvailable: v.inventory[0]?.quantity_available ?? 0,
          mapping: mapping
            ? {
                id: mapping.id,
                externalVariantId: mapping.external_variant_id,
                externalSku: mapping.external_sku,
                syncStatus: mapping.sync_status,
                lastSyncedAt: mapping.last_synced_at,
              }
            : null,
        }
      })
  })

/**
 * Connects a product to an already-existing listing on the channel by the
 * platform's own product id. Requires an exact match — same title, same
 * variant option values including letter case — the same rule enforced by
 * the seller's existing Shopify-side sync app; refuses (rather than
 * partially linking) if anything doesn't line up exactly.
 */
export const connectExistingProduct = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      marketplace: marketplaceSchema,
      productId: z.string().uuid(),
      externalProductId: z.string().trim().min(1),
    }),
  )
  .handler(
    async ({
      data,
    }): Promise<{ connectedVariants: number; unmatchedVariants: string[] }> => {
      const staff = await requireStaff(MANAGE_ROLES)
      const result = await connectExistingProductToMarketplace(
        data.marketplace,
        data.productId,
        data.externalProductId,
      )
      await logStaffActivity(
        staff,
        'channel.connect_existing_product',
        'products',
        data.productId,
        { marketplace: data.marketplace, ...result },
      )
      return result
    },
  )

/**
 * Auto-connects every currently-unlinked product to a same-titled TikTok
 * listing in one pass — staff only need to manually review whatever's left
 * in `skipped` (no match, an ambiguous multi-match, or a title/variant
 * mismatch caught by connectExistingProductToMarketplace's own exact-match
 * rule) via the existing "Connect existing" flow.
 */
export const autoConnectProducts = createServerFn({ method: 'POST' })
  .validator(z.object({ marketplace: marketplaceSchema }))
  .handler(async ({ data }): Promise<AutoConnectByTitleResult> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const result = await autoConnectProductsByTitle(data.marketplace)
    await logStaffActivity(
      staff,
      'channel.auto_connect_products',
      'marketplace_connections',
      null,
      {
        marketplace: data.marketplace,
        connected: result.connected.length,
        skipped: result.skipped.length,
      },
    )
    return result
  })

/**
 * Same as autoConnectProducts, but matches on a product's full set of
 * variant SKUs instead of its title — for products whose TikTok listing
 * title was never kept in sync with the website but whose SKUs still are.
 */
export const autoConnectBySku = createServerFn({ method: 'POST' })
  .validator(z.object({ marketplace: marketplaceSchema }))
  .handler(async ({ data }): Promise<AutoConnectBySkuResult> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const result = await autoConnectProductsBySku(data.marketplace)
    await logStaffActivity(
      staff,
      'channel.auto_connect_products_by_sku',
      'marketplace_connections',
      null,
      {
        marketplace: data.marketplace,
        connected: result.connected.length,
        skipped: result.skipped.length,
      },
    )
    return result
  })

/**
 * Re-checks every already-linked product against the channel's current
 * listing data and repairs any mapping whose variant id has drifted (see
 * revalidateAllMappedProducts' own comment for why that happens) — unlike
 * autoConnectProducts/autoConnectBySku, this deliberately re-checks
 * products that already have a mapping, not just unlinked ones. Finishes
 * with a forced push scoped to just the repaired products (not the whole
 * catalog — pushInventoryForAllProducts on top of a full revalidation pass
 * in the same request risks running past a serverless function's time
 * limit), so those specific products carry the right stock number and price
 * immediately rather than waiting on the next scheduled sync or a manual
 * price-sync toggle off/on (discovered live: a drifted mapping's stock came
 * back correct after revalidating, but its price stayed stale until sync
 * was force-repushed by hand, since only inventory was re-pushed here).
 */
export const revalidateMappings = createServerFn({ method: 'POST' })
  .validator(z.object({ marketplace: marketplaceSchema }))
  .handler(async ({ data }): Promise<RevalidateMappingsResult> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const result = await revalidateAllMappedProducts(data.marketplace)
    const fixedProductIds = result.fixed.map((f) => f.productId)
    await pushInventoryForProducts(fixedProductIds)
    await pushPriceForProducts(data.marketplace, fixedProductIds)
    await logStaffActivity(
      staff,
      'channel.revalidate_mappings',
      'marketplace_connections',
      null,
      {
        marketplace: data.marketplace,
        checked: result.checked,
        fixed: result.fixed.length,
        failed: result.failed.length,
      },
    )
    return result
  })

/**
 * Same repair as revalidateMappings, scoped to one product — for staff who
 * only want to fix a single drifted connection without re-checking (and
 * re-pushing stock/price for) the entire catalog.
 */
export const revalidateProductMapping = createServerFn({ method: 'POST' })
  .validator(
    z.object({ marketplace: marketplaceSchema, productId: z.string().uuid() }),
  )
  .handler(async ({ data }): Promise<RevalidateMappingsResult> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const result = await revalidateMapping(data.marketplace, data.productId)
    await logStaffActivity(
      staff,
      'channel.revalidate_mapping',
      'products',
      data.productId,
      {
        marketplace: data.marketplace,
        checked: result.checked,
        fixed: result.fixed.length,
        failed: result.failed.length,
      },
    )
    return result
  })

/**
 * A manual, one-off push for a single product — bypasses the channel-wide
 * inventory_sync_enabled opt-in (see pushOneMapping's comment) since a
 * staff member explicitly clicking this for one product isn't the
 * "uninvited automatic overwrite" scenario that opt-in guards against.
 */
export const syncProductNow = createServerFn({ method: 'POST' })
  .validator(z.object({ variantId: z.string().uuid() }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    await pushInventoryForVariant(data.variantId, { force: true })
    await logStaffActivity(
      staff,
      'channel.sync_product',
      'product_variants',
      data.variantId,
    )
    return { ok: true }
  })

export const bulkSyncChannel = createServerFn({ method: 'POST' })
  .validator(z.object({ marketplace: marketplaceSchema }))
  .handler(async ({ data }): Promise<{ attempted: number }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const result = await pushInventoryForAllProducts(data.marketplace, {
      force: true,
    })
    await logStaffActivity(
      staff,
      'channel.bulk_sync',
      'marketplace_connections',
      null,
      { marketplace: data.marketplace, attempted: result.attempted },
    )
    return result
  })

export const pullOrdersNow = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      marketplace: marketplaceSchema,
      sinceHours: z.number().min(1).max(720).default(24),
    }),
  )
  .handler(
    async ({
      data,
    }): Promise<{
      scanned: number
      imported: number
      failed: number
      returnsScanned: number
      returnsProcessed: number
      returnsFailed: number
    }> => {
      const staff = await requireStaff(MANAGE_ROLES)
      const since = new Date(Date.now() - data.sinceHours * 60 * 60 * 1000)
      const [orders, returns] = await Promise.all([
        pullOrdersForMarketplace(data.marketplace, since),
        pullReturnsForMarketplace(data.marketplace, since),
      ])
      const result = {
        ...orders,
        returnsScanned: returns.scanned,
        returnsProcessed: returns.processed,
        returnsFailed: returns.failed,
      }
      await logStaffActivity(
        staff,
        'channel.pull_orders',
        'marketplace_connections',
        null,
        { marketplace: data.marketplace, ...result },
      )
      return result
    },
  )

export const listMarketplaceCategories = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      marketplace: marketplaceSchema,
      query: z.string().trim().min(1),
    }),
  )
  .handler(async ({ data }): Promise<MarketplaceCategory[]> => {
    await requireStaff(MANAGE_ROLES)
    return listCategoriesForMarketplace(data.marketplace, data.query)
  })

export const getMarketplaceCategoryAttributes = createServerFn({
  method: 'GET',
})
  .validator(
    z.object({ marketplace: marketplaceSchema, categoryId: z.string() }),
  )
  .handler(async ({ data }): Promise<MarketplaceCategoryAttribute[]> => {
    await requireStaff(MANAGE_ROLES)
    return getCategoryAttributesForMarketplace(
      data.marketplace,
      data.categoryId,
    )
  })

/** Creates a brand-new listing on the channel from our product data (images, price, variants) — used the first time a product goes to that channel, unlike connectExistingProduct above which only maps to an already-existing listing. */
export const pushProductToMarketplace = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      marketplace: marketplaceSchema,
      productId: z.string().uuid(),
      categoryId: z.string(),
      attributeValues: z.array(
        z.object({
          attributeId: z.string(),
          valueId: z.string().optional(),
          value: z.string().optional(),
        }),
      ),
    }),
  )
  .handler(async ({ data }): Promise<{ externalProductId: string }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const result = await pushNewProductToMarketplace(
      data.marketplace,
      data.productId,
      data.categoryId,
      data.attributeValues,
    )
    await logStaffActivity(
      staff,
      'channel.push_new_product',
      'products',
      data.productId,
      {
        marketplace: data.marketplace,
        externalProductId: result.externalProductId,
      },
    )
    return result
  })

export interface SyncLogRow {
  id: string
  marketplace: MarketplaceName
  operation: string
  status: 'success' | 'failed'
  /** JSON-stringified — kept opaque here since it's just displayed as debug detail in the admin UI. */
  detail: string
  errorMessage: string | null
  createdAt: string
}

export const listRecentSyncLogs = createServerFn({ method: 'GET' })
  .validator(z.object({ marketplace: marketplaceSchema }))
  .handler(async ({ data }): Promise<SyncLogRow[]> => {
    await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: logs, error } = await admin
      .from('sync_logs')
      .select('*')
      .eq('marketplace', data.marketplace)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error

    return logs.map((l) => ({
      id: l.id,
      marketplace: l.marketplace,
      operation: l.operation,
      status: l.status,
      detail: JSON.stringify(l.detail),
      errorMessage: l.error_message,
      createdAt: l.created_at,
    }))
  })

export interface CategoryDefaultRow {
  productType: ProductType
  categoryId: string
  categoryName: string
  attributeDefaults: MarketplaceCategoryAttributeAnswer[]
}

/**
 * One row per product type that has a saved default — types with no
 * default simply have no entry, so the admin UI/push modal both treat a
 * missing lookup as "no default set yet" rather than needing a placeholder
 * row for every one of PRODUCT_TYPES.
 */
export const listCategoryDefaults = createServerFn({ method: 'GET' })
  .validator(z.object({ marketplace: marketplaceSchema }))
  .handler(async ({ data }): Promise<CategoryDefaultRow[]> => {
    await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: rows, error } = await admin
      .from('marketplace_category_defaults')
      .select('*')
      .eq('marketplace', data.marketplace)
    if (error) throw error

    return rows.map((r) => ({
      productType: r.product_type,
      categoryId: r.category_id,
      categoryName: r.category_name,
      attributeDefaults:
        r.attribute_defaults as MarketplaceCategoryAttributeAnswer[],
    }))
  })

export const setCategoryDefault = createServerFn({ method: 'POST' })
  .validator(setCategoryDefaultSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin.from('marketplace_category_defaults').upsert(
      {
        marketplace: data.marketplace,
        product_type: data.productType,
        category_id: data.categoryId,
        category_name: data.categoryName,
        attribute_defaults: data.attributeDefaults,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'marketplace,product_type' },
    )
    if (error) throw error

    await logStaffActivity(
      staff,
      'channel.set_category_default',
      'marketplace_category_defaults',
      null,
      {
        marketplace: data.marketplace,
        productType: data.productType,
        categoryId: data.categoryId,
      },
    )
    return { ok: true }
  })

export const deleteCategoryDefault = createServerFn({ method: 'POST' })
  .validator(deleteCategoryDefaultSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('marketplace_category_defaults')
      .delete()
      .eq('marketplace', data.marketplace)
      .eq('product_type', data.productType)
    if (error) throw error

    await logStaffActivity(
      staff,
      'channel.delete_category_default',
      'marketplace_category_defaults',
      null,
      { marketplace: data.marketplace, productType: data.productType },
    )
    return { ok: true }
  })

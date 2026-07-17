import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { collectionRuleSchema, matchesRules } from '#/lib/collections/rules'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { logStaffActivity } from './activity-log'
import { IMPLEMENTED_MARKETPLACES } from '#/server/integrations/marketplaces/registry'
import {
  autoConnectProductsByTitle,
  connectExistingProductToMarketplace,
  getCategoryAttributesForMarketplace,
  listCategoriesForMarketplace,
  pullOrdersForMarketplace,
  pushInventoryForAllProducts,
  pushInventoryForVariant,
  pushNewProductToMarketplace,
} from '#/server/integrations/marketplaces/sync-engine'
import type { AutoConnectByTitleResult } from '#/server/integrations/marketplaces/sync-engine'
import type {
  MarketplaceCategory,
  MarketplaceCategoryAttribute,
} from '#/server/integrations/marketplaces/types'
import type {
  MarketplaceConnection,
  MarketplaceName,
  StaffRole,
} from '#/types/entities'

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
      data.marketplace,
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
      data.marketplace,
      { enabled: data.enabled },
    )

    if (data.enabled) {
      await pushInventoryForAllProducts(data.marketplace)
    }

    return { ok: true }
  })

export interface ProductSyncRow {
  variantId: string
  productId: string
  productName: string
  productImage: string | null
  productCreatedAt: string
  sku: string
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
      sku: string
      size: string | null
      color: string | null
      style: string | null
      product: {
        id: string
        name: string
        images: string[]
        created_at: string
      }
      inventory: { quantity_available: number }[]
    }[] = []
    for (let page = 0; ; page++) {
      const { data: batch, error } = await admin
        .from('product_variants')
        .select(
          'id, sku, size, color, style, product:products(id, name, images, created_at), inventory(quantity_available)',
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
  .handler(async ({ data }): Promise<{ connectedVariants: number }> => {
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
  })

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
      data.marketplace,
      { connected: result.connected.length, skipped: result.skipped.length },
    )
    return result
  })

export const syncProductNow = createServerFn({ method: 'POST' })
  .validator(z.object({ variantId: z.string().uuid() }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    await pushInventoryForVariant(data.variantId)
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
    const result = await pushInventoryForAllProducts(data.marketplace)
    await logStaffActivity(
      staff,
      'channel.bulk_sync',
      'marketplace_connections',
      data.marketplace,
      { attempted: result.attempted },
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
    }): Promise<{ scanned: number; imported: number; failed: number }> => {
      const staff = await requireStaff(MANAGE_ROLES)
      const since = new Date(Date.now() - data.sinceHours * 60 * 60 * 1000)
      const result = await pullOrdersForMarketplace(data.marketplace, since)
      await logStaffActivity(
        staff,
        'channel.pull_orders',
        'marketplace_connections',
        data.marketplace,
        result,
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

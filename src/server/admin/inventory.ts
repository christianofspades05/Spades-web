import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { fetchAllRows } from '#/lib/utils/paginate'
import { resolveCollectionScopedProductIds } from '#/server/collections/scoped-products'

export interface InventoryRow {
  variantId: string
  sku: string | null
  size: string | null
  color: string | null
  style: string | null
  quantityOnHand: number
  quantityAvailable: number
  lowStockThreshold: number
  costCents: number | null
  createdAt: string
  productId: string
  productName: string
  productSlug: string
  productImage: string | null
  /** Last quantity we successfully pushed to that channel (already
   *  stock-buffer-adjusted) — read-only, not a live marketplace count.
   *  Null when the variant isn't mapped there or nothing's been pushed yet. */
  shopeeQuantity: number | null
  tiktokQuantity: number | null
}

export const listInventory = createServerFn({ method: 'GET' })
  .validator(
    z.object({ q: z.string().optional(), collectionId: z.string().uuid().optional() }),
  )
  .handler(async ({ data }): Promise<InventoryRow[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    let query = admin
      .from('product_variants')
      .select(
        'id, sku, size, color, style, cost_cents, created_at, product:products(id, name, slug, images), inventory(quantity_on_hand, quantity_available, low_stock_threshold)',
      )
      .order('sku', { ascending: true })

    const search = data.q?.trim()
    if (search) {
      const { data: matchingProducts } = await admin
        .from('products')
        .select('id')
        .ilike('name', `%${search}%`)
      const productIds = (matchingProducts ?? []).map((p) => p.id)

      const orFilter =
        productIds.length > 0
          ? `sku.ilike.%${search}%,product_id.in.(${productIds.join(',')})`
          : `sku.ilike.%${search}%`
      query = query.or(orFilter)
    }

    const { data: variants, error } = await query
    if (error) throw error

    let scopedVariants = variants
    if (data.collectionId) {
      const candidateProductIds = Array.from(
        new Set(variants.map((v) => v.product.id)),
      )
      const scopedProductIds = await resolveCollectionScopedProductIds(
        admin,
        [data.collectionId],
        candidateProductIds,
      )
      scopedVariants = variants.filter((v) => scopedProductIds.has(v.product.id))
    }

    // Read-only Shopee/TikTok stock columns — sourced from the last
    // successful push (see sync-engine.ts's pushOneMapping), not a live
    // marketplace call. Fetched by connection (at most a couple of rows)
    // rather than filtering marketplace_product_mappings by variant id,
    // since a large .in() id list can blow PostgREST's URL length limit —
    // matched to variants in memory instead.
    const { data: connections, error: connError } = await admin
      .from('marketplace_connections')
      .select('id, marketplace')
      .in('marketplace', ['shopee', 'tiktok_shop'])
    if (connError) throw connError

    const marketplaceByConnectionId = new Map(
      connections.map((c) => [c.id, c.marketplace]),
    )
    const connectionIds = connections.map((c) => c.id)

    const mappings =
      connectionIds.length > 0
        ? await fetchAllRows((offset) =>
            admin
              .from('marketplace_product_mappings')
              .select('variant_id, marketplace_connection_id, last_pushed_quantity')
              .in('marketplace_connection_id', connectionIds)
              .range(offset, offset + 999),
          )
        : []

    const channelQtyByVariant = new Map<
      string,
      { shopee: number | null; tiktok_shop: number | null }
    >()
    for (const m of mappings) {
      const marketplace = marketplaceByConnectionId.get(
        m.marketplace_connection_id,
      )
      if (marketplace !== 'shopee' && marketplace !== 'tiktok_shop') continue
      const entry = channelQtyByVariant.get(m.variant_id) ?? {
        shopee: null,
        tiktok_shop: null,
      }
      entry[marketplace] = m.last_pushed_quantity
      channelQtyByVariant.set(m.variant_id, entry)
    }

    return scopedVariants.map((v) => {
      const inv = v.inventory.at(0)
      const channelQty = channelQtyByVariant.get(v.id)
      return {
        variantId: v.id,
        sku: v.sku,
        size: v.size,
        color: v.color,
        style: v.style,
        quantityOnHand: inv?.quantity_on_hand ?? 0,
        quantityAvailable: inv?.quantity_available ?? 0,
        lowStockThreshold: inv?.low_stock_threshold ?? 5,
        costCents: v.cost_cents,
        createdAt: v.created_at,
        productId: v.product.id,
        productName: v.product.name,
        productSlug: v.product.slug,
        productImage: v.product.images[0] ?? null,
        shopeeQuantity: channelQty?.shopee ?? null,
        tiktokQuantity: channelQty?.tiktok_shop ?? null,
      }
    })
  })

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { logStaffActivity } from './activity-log'
import { IMPLEMENTED_MARKETPLACES } from '#/server/integrations/marketplaces/registry'
import {
  pullOrdersForMarketplace,
  pushInventoryForAllProducts,
  pushInventoryForVariant,
} from '#/server/integrations/marketplaces/sync-engine'
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

export interface ProductSyncRow {
  variantId: string
  productId: string
  productName: string
  productImage: string | null
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

export const listProductSyncStatus = createServerFn({ method: 'GET' })
  .validator(z.object({ marketplace: marketplaceSchema }))
  .handler(async ({ data }): Promise<ProductSyncRow[]> => {
    await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: connection } = await admin
      .from('marketplace_connections')
      .select('id')
      .eq('marketplace', data.marketplace)
      .maybeSingle()

    const { data: variants, error } = await admin
      .from('product_variants')
      .select(
        'id, sku, size, color, style, product:products(id, name, images), inventory(quantity_available)',
      )
      .eq('is_active', true)
      .order('sku', { ascending: true })
    if (error) throw error

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

    return variants.map((v) => {
      const mapping = mappingByVariantId.get(v.id)
      return {
        variantId: v.id,
        productId: v.product.id,
        productName: v.product.name,
        productImage: v.product.images[0] ?? null,
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

/** Manually links one of our variants to a platform's SKU/variant id, so it becomes syncable. */
export const linkProductToChannel = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      marketplace: marketplaceSchema,
      variantId: z.string().uuid(),
      externalVariantId: z.string().trim().min(1),
      externalSku: z.string().trim().optional(),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: connection, error: connectionError } = await admin
      .from('marketplace_connections')
      .select('id')
      .eq('marketplace', data.marketplace)
      .maybeSingle()
    if (connectionError) throw connectionError
    if (!connection) {
      throw new Error(`Connect ${data.marketplace} before linking products.`)
    }

    const { error } = await admin.from('marketplace_product_mappings').upsert(
      {
        marketplace_connection_id: connection.id,
        variant_id: data.variantId,
        external_variant_id: data.externalVariantId,
        external_sku: data.externalSku ?? null,
        sync_status: 'pending',
      },
      { onConflict: 'marketplace_connection_id,external_variant_id' },
    )
    if (error) throw error

    await logStaffActivity(
      staff,
      'channel.link_product',
      'marketplace_product_mappings',
      data.variantId,
      {
        marketplace: data.marketplace,
        externalVariantId: data.externalVariantId,
      },
    )

    // Push current stock right away so a newly-linked product doesn't sit
    // showing 0/whatever the platform's default is until the next cron run.
    await pushInventoryForVariant(data.variantId)

    return { ok: true }
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

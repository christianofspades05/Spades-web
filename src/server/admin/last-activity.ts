import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'

export interface LastActivityInfo {
  updatedAt: string
  staffName: string | null
}

/**
 * Batch "last updated" lookup for the Products list / Product editor page.
 * Backed by get_product_last_activity, which fans out across direct product
 * edits, variant quick-edits, and inventory adjustments in one round trip
 * (see 0083_last_activity_functions.sql) — a product with no activity_logs
 * history simply has no entry in the returned record.
 */
export const getProductsLastActivity = createServerFn({ method: 'GET' })
  .validator(z.object({ productIds: z.array(z.string()) }))
  .handler(async ({ data }): Promise<Record<string, LastActivityInfo>> => {
    await requireStaff()
    if (data.productIds.length === 0) return {}

    const admin = getSupabaseAdminClient()
    const { data: rows, error } = await admin.rpc('get_product_last_activity', {
      product_ids: data.productIds,
    })
    if (error) throw error

    const result: Record<string, LastActivityInfo> = {}
    for (const row of rows) {
      result[row.product_id] = { updatedAt: row.updated_at, staffName: row.staff_name }
    }
    return result
  })

/**
 * Variant-scoped counterpart for the Inventory page, keyed by variant id
 * rather than product id (see get_variant_last_activity).
 */
export const getVariantsLastActivity = createServerFn({ method: 'GET' })
  .validator(z.object({ variantIds: z.array(z.string()) }))
  .handler(async ({ data }): Promise<Record<string, LastActivityInfo>> => {
    await requireStaff()
    if (data.variantIds.length === 0) return {}

    const admin = getSupabaseAdminClient()
    const { data: rows, error } = await admin.rpc('get_variant_last_activity', {
      variant_ids: data.variantIds,
    })
    if (error) throw error

    const result: Record<string, LastActivityInfo> = {}
    for (const row of rows) {
      result[row.variant_id] = { updatedAt: row.updated_at, staffName: row.staff_name }
    }
    return result
  })

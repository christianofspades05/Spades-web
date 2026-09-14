import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'

export interface LastActivityInfo {
  updatedAt: string
  staffName: string | null
  /** Present only when the most recent activity for this variant was a
   *  stock adjustment (inventory.adjust) — never for a plain variant edit
   *  (price/SKU/etc.), which logs no `delta`. newQuantity is the on-hand
   *  count immediately after that specific edit, captured at the time (see
   *  products.ts's inventory.adjust log call) — null for older log rows
   *  from before this was captured, since it can't be safely reconstructed
   *  from today's stock (a sale/return can move stock afterward without
   *  its own staff activity log entry). */
  stockChange?: { delta: number; newQuantity: number | null }
  /** Product-scoped only: the sum of each of this product's variants' own
   *  latest stock adjustment (one per variant that has any, not every
   *  adjustment ever) — e.g. "Staff adjusted stock +123" for a product with
   *  several sizes each recently restocked. Undefined when no variant has
   *  an inventory.adjust log at all. */
  totalStockDelta?: number
}

function parseStockChange(
  metadata: Record<string, unknown> | null | undefined,
): LastActivityInfo['stockChange'] {
  const delta = metadata?.delta
  if (typeof delta !== 'number') return undefined
  const newQuantity = metadata?.newQuantity
  return { delta, newQuantity: typeof newQuantity === 'number' ? newQuantity : null }
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
      result[row.product_id] = {
        updatedAt: row.updated_at,
        staffName: row.staff_name,
        totalStockDelta: row.total_stock_delta ?? undefined,
      }
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
      result[row.variant_id] = {
        updatedAt: row.updated_at,
        staffName: row.staff_name,
        stockChange: parseStockChange(row.metadata),
      }
    }
    return result
  })

/**
 * Admin "Stock Audit" page (Products > Stock Audit) — flags active
 * products' variants that are either below LOW_STOCK_THRESHOLD or sold out
 * with a sale in the last SOLD_OUT_LOOKBACK_DAYS days, so staff know to go
 * physically recount that shelf rather than trust a system number that may
 * have drifted.
 *
 * "Mark recounted" doesn't change quantity_available itself — it's a
 * separate manual physical count, done off-screen — it just records that
 * staff confirmed the number at this exact quantity, via
 * variant_stock_recounts. A row disappears from the audit only while the
 * live quantity still matches what was last recounted; any change since
 * (more sales, a restock) makes that confirmation stale and it reappears.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { fetchAllRows } from '#/lib/utils/paginate'
import { logStaffActivity } from './activity-log'
import type { StaffRole } from '#/types/entities'

const MANAGE_ROLES: StaffRole[] = [
  'super_admin',
  'admin',
  'manager',
  'packer',
]

const LOW_STOCK_THRESHOLD = 10
const SOLD_OUT_LOOKBACK_DAYS = 7

export interface StockAuditRow {
  variantId: string
  productId: string
  productName: string
  productImage: string | null
  sku: string | null
  size: string | null
  color: string | null
  style: string | null
  quantityAvailable: number
  /** Sold at least once in the last SOLD_OUT_LOOKBACK_DAYS days while at 0
   *  stock — the more urgent of the two flag reasons (real lost sales, not
   *  just a low-but-moving number). */
  soldOutRecently: boolean
  /** When this variant was last confirmed at a DIFFERENT quantity than
   *  it's at now — shown so staff can see it's drifted since the last
   *  count, not just that it's never been counted. Null if never
   *  recounted. */
  previousRecountAt: string | null
}

export const listStockAuditRows = createServerFn({ method: 'GET' }).handler(
  async (): Promise<StockAuditRow[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    // Paginated explicitly — PostgREST caps an unbounded select at 1000
    // rows, and this catalog already has well over that many variants.
    const variants = await fetchAllRows((offset) =>
      admin
        .from('product_variants')
        .select(
          'id, sku, size, color, style, product:products(id, name, images, status), inventory(quantity_available)',
        )
        .range(offset, offset + 999),
    )

    const lowStock = variants
      .filter((v) => v.product.status === 'active')
      .map((v) => ({
        variant: v,
        quantityAvailable: v.inventory.at(0)?.quantity_available ?? 0,
      }))
      .filter((v) => v.quantityAvailable < LOW_STOCK_THRESHOLD)

    if (lowStock.length === 0) return []

    const lookbackIso = new Date(
      Date.now() - SOLD_OUT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString()

    // Recent sales, resolved separately rather than as a filter on
    // order_items directly — need orders.status/placed_at, and order_items
    // has no declared relation back to orders to embed that in one query.
    const recentOrders = await fetchAllRows((offset) =>
      admin
        .from('orders')
        .select('id, order_items(variant_id)')
        .gte('placed_at', lookbackIso)
        .not('status', 'in', '(cancelled,failed)')
        .range(offset, offset + 999),
    )
    const recentlySoldVariantIds = new Set(
      recentOrders.flatMap((o) =>
        o.order_items
          .map((i) => i.variant_id)
          .filter((id): id is string => id !== null),
      ),
    )

    // Fetched in full (paginated, not filtered by variant id) — with
    // hundreds of low-stock variants a large .in() id list here would blow
    // past PostgREST's URL length limit. This table only ever holds one
    // row per ever-recounted variant, so it stays small regardless of how
    // large the low-stock list gets.
    const recounts = await fetchAllRows((offset) =>
      admin
        .from('variant_stock_recounts')
        .select('variant_id, recounted_quantity_available, recounted_at')
        .range(offset, offset + 999),
    )
    const recountByVariantId = new Map(
      recounts.map((r) => [r.variant_id, r]),
    )

    return lowStock
      .filter(({ variant, quantityAvailable }) => {
        const recount = recountByVariantId.get(variant.id)
        // Still flagged unless it was last recounted at exactly this
        // quantity — any drift since then (either direction) means the
        // confirmation no longer speaks for the current number.
        return (
          !recount ||
          recount.recounted_quantity_available !== quantityAvailable
        )
      })
      .map(({ variant, quantityAvailable }) => ({
        variantId: variant.id,
        productId: variant.product.id,
        productName: variant.product.name,
        productImage: variant.product.images[0] ?? null,
        sku: variant.sku,
        size: variant.size,
        color: variant.color,
        style: variant.style,
        quantityAvailable,
        soldOutRecently:
          quantityAvailable === 0 && recentlySoldVariantIds.has(variant.id),
        previousRecountAt: recountByVariantId.get(variant.id)?.recounted_at ?? null,
      }))
      .sort((a, b) => {
        if (a.soldOutRecently !== b.soldOutRecently) {
          return a.soldOutRecently ? -1 : 1
        }
        return a.quantityAvailable - b.quantityAvailable
      })
  },
)

export const markVariantRecounted = createServerFn({ method: 'POST' })
  .validator(z.object({ variantId: z.string().uuid() }))
  .handler(async ({ data }): Promise<void> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: inventoryRow, error: inventoryError } = await admin
      .from('inventory')
      .select('quantity_available')
      .eq('variant_id', data.variantId)
      .maybeSingle()
    if (inventoryError) throw inventoryError

    const { error } = await admin.from('variant_stock_recounts').upsert(
      {
        variant_id: data.variantId,
        recounted_quantity_available: inventoryRow?.quantity_available ?? 0,
        recounted_at: new Date().toISOString(),
        staff_user_id: staff.id,
      },
      { onConflict: 'variant_id' },
    )
    if (error) throw error

    await logStaffActivity(
      staff,
      'stock_audit.mark_recounted',
      'product_variants',
      data.variantId,
      { quantityAvailable: inventoryRow?.quantity_available ?? 0 },
    )
  })

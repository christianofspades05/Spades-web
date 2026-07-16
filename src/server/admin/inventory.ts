import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'

export interface InventoryRow {
  variantId: string
  sku: string
  size: string | null
  color: string | null
  style: string | null
  quantityOnHand: number
  quantityAvailable: number
  lowStockThreshold: number
  costCents: number | null
  productId: string
  productName: string
  productSlug: string
  productImage: string | null
}

export const listInventory = createServerFn({ method: 'GET' })
  .validator(z.object({ q: z.string().optional() }))
  .handler(async ({ data }): Promise<InventoryRow[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    let query = admin
      .from('product_variants')
      .select(
        'id, sku, size, color, style, cost_cents, product:products(id, name, slug, images), inventory(quantity_on_hand, quantity_available, low_stock_threshold)',
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

    return variants.map((v) => {
      const inv = v.inventory[0]
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
        productId: v.product.id,
        productName: v.product.name,
        productSlug: v.product.slug,
        productImage: v.product.images[0] ?? null,
      }
    })
  })

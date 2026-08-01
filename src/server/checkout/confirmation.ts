/**
 * Public lookup for the checkout confirmation ("thank you") page — reached
 * right after a guest or logged-in checkout, before any session necessarily
 * exists (place-order.ts supports guest carts). The order number in the URL
 * (the same value Xendit's success redirect and the COD path already pass)
 * is the only "credential" this page has, same as most storefronts' own
 * thank-you pages — so this intentionally returns only what's already safe
 * to show there: item names/quantities/images. No customer, address, or
 * payment info.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'

/** Mirrors the same helper in src/server/admin/orders.ts and src/server/account/queries.ts. */
async function getProductImagesByVariantId(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  variantIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  if (variantIds.length === 0) return map

  const { data, error } = await admin
    .from('product_variants')
    .select('id, product:products(images)')
    .in('id', variantIds)
  if (error) throw error

  for (const row of data) {
    map.set(row.id, row.product.images[0] ?? null)
  }
  return map
}

export interface ConfirmationOrderItem {
  id: string
  productName: string
  variantLabel: string | null
  quantity: number
  imageUrl: string | null
}

export const getOrderConfirmationItems = createServerFn({ method: 'GET' })
  .validator(z.object({ orderNumber: z.string().min(1) }))
  .handler(async ({ data }): Promise<ConfirmationOrderItem[] | null> => {
    const admin = getSupabaseAdminClient()
    const { data: order, error } = await admin
      .from('orders')
      .select(
        'id, order_items(id, product_name_snapshot, variant_label_snapshot, quantity, variant_id)',
      )
      .eq('order_number', data.orderNumber)
      .maybeSingle()
    if (error) throw error
    if (!order) return null

    const variantIds = Array.from(
      new Set(
        order.order_items
          .map((i) => i.variant_id)
          .filter((v): v is string => !!v),
      ),
    )
    const imageMap = await getProductImagesByVariantId(admin, variantIds)

    return order.order_items.map((item) => ({
      id: item.id,
      productName: item.product_name_snapshot,
      variantLabel: item.variant_label_snapshot,
      quantity: item.quantity,
      imageUrl: item.variant_id ? (imageMap.get(item.variant_id) ?? null) : null,
    }))
  })

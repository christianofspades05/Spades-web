import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { getCartToken, setCartToken } from '#/lib/cart/cart-cookie'
import { getActiveVariantStock, loadCartWithItems } from './internal'
import type { CartWithItems } from './internal'

const reorderFromOrderSchema = z.object({ orderId: z.string().uuid() })

const MAX_QUANTITY_PER_ITEM = 20

// Deliberately NOT imported from mutations.ts's getOrCreateCartId: exporting
// that plain helper so this file could import it made rolldown keep it (and
// its cart-cookie.ts -> @tanstack/react-start/server import) alive in the
// client bundle, since an exported binding can't be tree-shaken away just
// because the client chunk doesn't call it. Kept private and duplicated
// here instead, so it stays reachable only from inside this file's own
// createServerFn handler, which the client build strips.
async function getOrCreateCartId(
  admin: ReturnType<typeof getSupabaseAdminClient>,
) {
  const token = getCartToken()
  if (token) {
    const { data: existing, error } = await admin
      .from('carts')
      .select('id')
      .eq('session_token', token)
      .eq('status', 'active')
      .maybeSingle()
    if (error) throw error
    if (existing) return existing.id
  }

  const newToken = crypto.randomUUID()
  const { data: cart, error } = await admin
    .from('carts')
    .insert({ session_token: newToken })
    .select('id')
    .single()
  if (error) throw error

  setCartToken(newToken)
  return cart.id
}

/**
 * Rebuilds a cart from a past order's line items — the "reorder" link in
 * the failed-delivery email (see cancelOrder in server/admin/orders.ts).
 * Resolves/creates the cart ONCE (getOrCreateCartId sets a cookie on this
 * response; calling addCartItem itself in a loop would re-read the
 * *incoming* request's cookie every time via getCartToken, which hasn't
 * changed mid-request — every item would land in its own separate new
 * cart instead of one shared cart, and only the last one would actually
 * end up linked to the browser).
 *
 * Silently skips a line whose variant is gone, deactivated, out of stock,
 * or now a pre-order (never mixes a pre-order into this cart — the
 * original failed-delivery order was real ready-to-ship stock by
 * definition, so this only ever adds regular items) — one bad item
 * shouldn't block the rest of a reorder link from working.
 */
export const reorderFromOrder = createServerFn({ method: 'GET' })
  .validator(reorderFromOrderSchema)
  .handler(async ({ data }): Promise<CartWithItems> => {
    const admin = getSupabaseAdminClient()

    const { data: items, error } = await admin
      .from('order_items')
      .select('variant_id, quantity')
      .eq('order_id', data.orderId)
    if (error) throw error

    const cartId = await getOrCreateCartId(admin)

    for (const item of items) {
      if (!item.variant_id) continue
      const stock = await getActiveVariantStock(admin, item.variant_id)
      if (!stock || stock.isPreOrder || stock.availableStock <= 0) continue

      const { data: existingItem, error: existingError } = await admin
        .from('cart_items')
        .select('id, quantity')
        .eq('cart_id', cartId)
        .eq('variant_id', item.variant_id)
        .maybeSingle()
      if (existingError) throw existingError

      const quantity = Math.min(
        (existingItem?.quantity ?? 0) + item.quantity,
        stock.availableStock,
        MAX_QUANTITY_PER_ITEM,
      )

      if (existingItem) {
        const { error: updateError } = await admin
          .from('cart_items')
          .update({ quantity, price_cents_snapshot: stock.priceCents })
          .eq('id', existingItem.id)
        if (updateError) throw updateError
      } else {
        const { error: insertError } = await admin.from('cart_items').insert({
          cart_id: cartId,
          variant_id: item.variant_id,
          quantity,
          price_cents_snapshot: stock.priceCents,
        })
        if (insertError) throw insertError
      }
    }

    return loadCartWithItems(admin, cartId)
  })

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { getCartToken } from '#/lib/cart/cart-cookie'
import { getStorefrontScope } from '#/server/storefront/domain'
import { loadCartWithItems } from './internal'
import type { CartWithItems } from './internal'
import {
  getActiveGiftDiscount,
  listGiftChoices,
  resolveFreeGiftOffer,
} from './free-gift'
import type { FreeGiftChoice } from './free-gift'

async function activeCartId(
  admin: ReturnType<typeof getSupabaseAdminClient>,
): Promise<string | null> {
  const token = getCartToken()
  if (!token) return null
  const { data, error } = await admin
    .from('carts')
    .select('id')
    .eq('session_token', token)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

/** What the customer can pick as their free item — empty unless the cart
 *  currently qualifies for a free gift deal. */
export const getFreeGiftChoices = createServerFn({ method: 'GET' }).handler(
  async (): Promise<FreeGiftChoice[]> => {
    const admin = getSupabaseAdminClient()
    const cartId = await activeCartId(admin)
    if (!cartId) return []
    const cart = await loadCartWithItems(admin, cartId)
    if (!cart.freeGift || cart.freeGift.itemsNeeded > 0) return []
    const gift = await getActiveGiftDiscount(admin, cart.freeGift.discountId)
    if (!gift) return []
    const { brand } = await getStorefrontScope()
    return listGiftChoices(admin, gift, brand)
  },
)

/** Saves (or clears, with null) the customer's free item pick. */
export const selectFreeGift = createServerFn({ method: 'POST' })
  .validator(z.object({ variantId: z.string().uuid().nullable() }))
  .handler(async ({ data }): Promise<CartWithItems> => {
    const admin = getSupabaseAdminClient()
    const cartId = await activeCartId(admin)
    if (!cartId) throw new Error('Your cart is empty')

    if (data.variantId) {
      const cart = await loadCartWithItems(admin, cartId)
      const { brand } = await getStorefrontScope()
      const offer = await resolveFreeGiftOffer(
        admin,
        cart.items,
        data.variantId,
        brand,
      )
      if (!offer?.pick) {
        throw new Error("That item can't be picked as your free item")
      }
    }

    const { error } = await admin
      .from('carts')
      .update({ free_gift_variant_id: data.variantId })
      .eq('id', cartId)
    if (error) throw error
    return loadCartWithItems(admin, cartId)
  })

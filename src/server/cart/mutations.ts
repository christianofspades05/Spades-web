import { createServerFn } from '@tanstack/react-start'
import {
  addCartItemSchema,
  applyDiscountCodeSchema,
  removeCartItemSchema,
  saveCartEmailSchema,
  updateCartItemQuantitySchema,
} from '#/lib/validation/cart'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { getCartToken, setCartToken } from '#/lib/cart/cart-cookie'
import {
  assertOwnsCart,
  getActiveVariantStock,
  loadCartWithItems,
} from './internal'
import type { CartWithItems } from './internal'
import { findValidDiscountByCode } from './discount'

const MAX_QUANTITY_PER_ITEM = 20

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

export const addCartItem = createServerFn({ method: 'POST' })
  .validator(addCartItemSchema)
  .handler(async ({ data }): Promise<CartWithItems> => {
    const admin = getSupabaseAdminClient()
    const stock = await getActiveVariantStock(admin, data.variantId)
    if (!stock || stock.availableStock <= 0) {
      throw new Error('This item is out of stock')
    }

    const cartId = await getOrCreateCartId(admin)

    const { data: existingItem, error: existingError } = await admin
      .from('cart_items')
      .select('id, quantity')
      .eq('cart_id', cartId)
      .eq('variant_id', data.variantId)
      .maybeSingle()
    if (existingError) throw existingError

    const requestedQuantity = (existingItem?.quantity ?? 0) + data.quantity
    const quantity = Math.min(
      requestedQuantity,
      stock.availableStock,
      MAX_QUANTITY_PER_ITEM,
    )

    if (existingItem) {
      const { error } = await admin
        .from('cart_items')
        .update({ quantity, price_cents_snapshot: stock.priceCents })
        .eq('id', existingItem.id)
      if (error) throw error
    } else {
      const { error } = await admin.from('cart_items').insert({
        cart_id: cartId,
        variant_id: data.variantId,
        quantity,
        price_cents_snapshot: stock.priceCents,
      })
      if (error) throw error
    }

    return loadCartWithItems(admin, cartId)
  })

export const updateCartItemQuantity = createServerFn({ method: 'POST' })
  .validator(updateCartItemQuantitySchema)
  .handler(async ({ data }): Promise<CartWithItems> => {
    const admin = getSupabaseAdminClient()
    const token = getCartToken()

    const { data: item, error: itemError } = await admin
      .from('cart_items')
      .select('cart_id, variant_id')
      .eq('id', data.cartItemId)
      .single()
    if (itemError) throw itemError

    await assertOwnsCart(admin, item.cart_id, token)

    const stock = await getActiveVariantStock(admin, item.variant_id)
    if (!stock) throw new Error('This item is no longer available')

    const quantity = Math.min(
      data.quantity,
      stock.availableStock,
      MAX_QUANTITY_PER_ITEM,
    )
    const { error } = await admin
      .from('cart_items')
      .update({ quantity, price_cents_snapshot: stock.priceCents })
      .eq('id', data.cartItemId)
    if (error) throw error

    return loadCartWithItems(admin, item.cart_id)
  })

export const removeCartItem = createServerFn({ method: 'POST' })
  .validator(removeCartItemSchema)
  .handler(async ({ data }): Promise<CartWithItems> => {
    const admin = getSupabaseAdminClient()
    const token = getCartToken()

    const { data: item, error: itemError } = await admin
      .from('cart_items')
      .select('cart_id')
      .eq('id', data.cartItemId)
      .single()
    if (itemError) throw itemError

    await assertOwnsCart(admin, item.cart_id, token)

    const { error } = await admin
      .from('cart_items')
      .delete()
      .eq('id', data.cartItemId)
    if (error) throw error

    return loadCartWithItems(admin, item.cart_id)
  })

async function getActiveCartId(
  admin: ReturnType<typeof getSupabaseAdminClient>,
): Promise<string> {
  const token = getCartToken()
  if (!token) throw new Error('Your cart is empty')

  const { data: cart, error } = await admin
    .from('carts')
    .select('id')
    .eq('session_token', token)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  if (!cart) throw new Error('Your cart is empty')

  return cart.id
}

export const applyDiscountCode = createServerFn({ method: 'POST' })
  .validator(applyDiscountCodeSchema)
  .handler(async ({ data }): Promise<CartWithItems> => {
    const admin = getSupabaseAdminClient()
    const cartId = await getActiveCartId(admin)

    const { data: items, error: itemsError } = await admin
      .from('cart_items')
      .select(
        '*, variant:product_variants(*, product:products(id, slug, name, images))',
      )
      .eq('cart_id', cartId)
    if (itemsError) throw itemsError
    if (items.length === 0) throw new Error('Your cart is empty')

    const discount = await findValidDiscountByCode(admin, data.code, items)

    const { error } = await admin
      .from('carts')
      .update({ discount_id: discount.id })
      .eq('id', cartId)
    if (error) throw error

    return loadCartWithItems(admin, cartId)
  })

export const removeDiscountCode = createServerFn({ method: 'POST' }).handler(
  async (): Promise<CartWithItems> => {
    const admin = getSupabaseAdminClient()
    const cartId = await getActiveCartId(admin)

    const { error } = await admin
      .from('carts')
      .update({ discount_id: null })
      .eq('id', cartId)
    if (error) throw error

    return loadCartWithItems(admin, cartId)
  },
)

/**
 * Best-effort capture of the checkout email onto the cart, called
 * opportunistically from a field blur — before the order is placed —
 * so an abandoned-cart reminder has somewhere to send. Deliberately
 * forgiving (never throws "cart empty" the way getActiveCartId does):
 * a missing/expired cart cookie here is a normal silent no-op, not
 * something that should ever surface to the customer or block checkout.
 */
export const saveCartEmail = createServerFn({ method: 'POST' })
  .validator(saveCartEmailSchema)
  .handler(async ({ data }): Promise<{ saved: boolean }> => {
    const admin = getSupabaseAdminClient()
    const token = getCartToken()
    if (!token) return { saved: false }

    const { data: cart, error } = await admin
      .from('carts')
      .update({ email: data.email })
      .eq('session_token', token)
      .eq('status', 'active')
      .select('id')
      .maybeSingle()
    if (error) throw error
    return { saved: Boolean(cart) }
  })

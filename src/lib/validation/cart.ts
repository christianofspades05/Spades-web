import { z } from 'zod'

/**
 * Input validation for cart mutations. Note there is no `price` field here
 * by design — the client can never set a price. `server/cart` always looks
 * up the authoritative price from `product_variants` before writing a
 * `cart_items` row.
 */
export const addCartItemSchema = z.object({
  cartId: z.string().uuid().optional(),
  variantId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
})

export const updateCartItemQuantitySchema = z.object({
  cartItemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
})

export const removeCartItemSchema = z.object({
  cartItemId: z.string().uuid(),
})

export type AddCartItemInput = z.infer<typeof addCartItemSchema>
export type UpdateCartItemQuantityInput = z.infer<typeof updateCartItemQuantitySchema>
export type RemoveCartItemInput = z.infer<typeof removeCartItemSchema>

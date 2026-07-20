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

export const applyDiscountCodeSchema = z.object({
  code: z.string().trim().min(1).max(50),
})

export const saveCartEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
})

export type AddCartItemInput = z.infer<typeof addCartItemSchema>
export type UpdateCartItemQuantityInput = z.infer<
  typeof updateCartItemQuantitySchema
>
export type RemoveCartItemInput = z.infer<typeof removeCartItemSchema>
export type ApplyDiscountCodeInput = z.infer<typeof applyDiscountCodeSchema>
export type SaveCartEmailInput = z.infer<typeof saveCartEmailSchema>

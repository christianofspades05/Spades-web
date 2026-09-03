/** Shared helpers for src/server/cart/queries.ts and mutations.ts. */
import type { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type { CartItemWithVariant } from '#/types/entities'
import { resolveAutomaticDiscountsForCart, resolveDiscountForCart } from './discount'
import type { AppliedCartDiscount } from './discount'
import { resolveCodAvailability } from './cod-restrictions'

type Admin = ReturnType<typeof getSupabaseAdminClient>

export interface CartWithItems {
  id: string
  currency: string
  items: CartItemWithVariant[]
  discount: AppliedCartDiscount | null
  codAvailable: boolean
  codUnavailableReason: string | null
}

export async function loadCartWithItems(
  admin: Admin,
  cartId: string,
): Promise<CartWithItems> {
  const [{ data: cart, error: cartError }, { data: items, error: itemsError }] =
    await Promise.all([
      admin
        .from('carts')
        .select('id, currency, discount_id')
        .eq('id', cartId)
        .single(),
      admin
        .from('cart_items')
        .select(
          '*, variant:product_variants(*, product:products(id, slug, name, images))',
        )
        .eq('cart_id', cartId)
        .order('created_at', { ascending: true }),
    ])

  if (cartError) throw cartError
  if (itemsError) throw itemsError

  const [codeDiscount, cod] = await Promise.all([
    resolveDiscountForCart(admin, cart.discount_id, items),
    resolveCodAvailability(admin, items),
  ])
  // A customer-entered code always wins if one's attached — never silently
  // swapped out for an automatic sale, even a bigger one, since applying a
  // code was an explicit action (its own stacking, if any, is handled
  // inside resolveDiscountForCart). Only fall back to every currently
  // active automatic discount, stacked together, when there's no code.
  const discount =
    codeDiscount ?? (await resolveAutomaticDiscountsForCart(admin, items))

  return {
    id: cart.id,
    currency: cart.currency,
    items,
    discount,
    codAvailable: cod.available,
    codUnavailableReason: cod.reason,
  }
}

/** Throws unless the cart identified by `cartId` belongs to the given guest session token. */
export async function assertOwnsCart(
  admin: Admin,
  cartId: string,
  token: string | undefined,
) {
  if (!token) throw new Error('No cart session')
  const { data: cart, error } = await admin
    .from('carts')
    .select('id, session_token')
    .eq('id', cartId)
    .single()
  if (error) throw error
  if (cart.session_token !== token) throw new Error('Not your cart')
}

/** Sums `inventory.quantity_available` across locations for one variant,
 *  plus its pre-order availability (a separate pool — see
 *  0086_pre_orders.sql for why this isn't just another `inventory` row).
 *  Returns null if the variant doesn't exist or is inactive.
 *
 *  `availableStock` is real stock only, deliberately never blended with
 *  pre-order availability — callers that need "can this be added to cart
 *  right now, in either mode" should check `availableStock > 0 ||
 *  preOrderAvailable > 0` explicitly, so a customer is never shown "in
 *  stock" for something that's actually a pre-order. */
export interface VariantStock {
  priceCents: number
  availableStock: number
  isPreOrder: boolean
  preOrderAvailable: number
}

export async function getActiveVariantStock(
  admin: Admin,
  variantId: string,
): Promise<VariantStock | null> {
  const { data: variant, error } = await admin
    .from('product_variants')
    .select(
      'price_cents, is_active, is_pre_order, pre_order_available, inventory(quantity_available)',
    )
    .eq('id', variantId)
    .maybeSingle()

  if (error) throw error
  if (!variant || !variant.is_active) return null

  const availableStock = variant.inventory.reduce(
    (sum, inv) => sum + inv.quantity_available,
    0,
  )
  return {
    priceCents: variant.price_cents,
    availableStock,
    isPreOrder: variant.is_pre_order,
    preOrderAvailable: variant.is_pre_order ? variant.pre_order_available : 0,
  }
}

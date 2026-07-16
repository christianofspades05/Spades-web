/** Shared helpers for src/server/cart/queries.ts and mutations.ts. */
import type { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type { CartItemWithVariant } from '#/types/entities'
import { resolveDiscountForCart } from './discount'
import type { AppliedCartDiscount } from './discount'
import { resolveCodAvailability } from './cod-restrictions'

type Admin = ReturnType<typeof getSupabaseAdminClient>

export interface CartWithItems {
  id: string
  currency: string
  items: CartItemWithVariant[]
  discount: AppliedCartDiscount | null
  codAvailable: boolean
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

  const [discount, codAvailable] = await Promise.all([
    resolveDiscountForCart(admin, cart.discount_id, items),
    resolveCodAvailability(admin, items),
  ])

  return { id: cart.id, currency: cart.currency, items, discount, codAvailable }
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

/** Sums `inventory.quantity_available` across locations for one variant. Returns null if the variant doesn't exist or is inactive. */
export async function getActiveVariantStock(
  admin: Admin,
  variantId: string,
): Promise<{ priceCents: number; availableStock: number } | null> {
  const { data: variant, error } = await admin
    .from('product_variants')
    .select('price_cents, is_active, inventory(quantity_available)')
    .eq('id', variantId)
    .maybeSingle()

  if (error) throw error
  if (!variant || !variant.is_active) return null

  const availableStock = variant.inventory.reduce(
    (sum, inv) => sum + inv.quantity_available,
    0,
  )
  return { priceCents: variant.price_cents, availableStock }
}

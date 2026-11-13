/** Shared helpers for src/server/cart/queries.ts and mutations.ts. */
import type { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type { CartItemWithVariant } from '#/types/entities'
import {
  isDiscountRedeemable,
  resolveAutomaticDiscountsForCart,
  resolveDiscountForCart,
} from './discount'
import type { AppliedCartDiscount } from './discount'
import { resolveCodAvailability } from './cod-restrictions'

type Admin = ReturnType<typeof getSupabaseAdminClient>

/** A cart line asking for more than is available right now — the size sold
 *  out (or ran low) after it was added. Surfaced at the top of the cart and
 *  checkout pages so the shopper fixes it before filling in the form, not
 *  after tapping Place Order (which re-checks the same thing and rejects). */
export interface CartStockIssue {
  cartItemId: string
  productName: string
  productSlug: string
  /** e.g. "L" or "L / Black" — null for a single-variant product. */
  variantLabel: string | null
  requestedQuantity: number
  /** 0 = sold out (or the variant was deactivated). */
  availableQuantity: number
}

export interface CartWithItems {
  id: string
  currency: string
  items: CartItemWithVariant[]
  discount: AppliedCartDiscount | null
  codAvailable: boolean
  codUnavailableReason: string | null
  stockIssues: CartStockIssue[]
  /** Set only on the load that just dropped an expired/used-up code from
   *  this cart (see detachUnredeemableDiscount) — lets place-order refuse to
   *  charge a total the shopper never saw. */
  removedDiscountCode: string | null
}

/** One query for every line's live stock, using the same rule as
 *  place-order.ts and addCartItem: a pre-order variant is checked against
 *  its pre-order pool only, everything else against real stock. */
async function findCartStockIssues(
  admin: Admin,
  items: CartItemWithVariant[],
): Promise<CartStockIssue[]> {
  if (items.length === 0) return []
  const variantIds = Array.from(new Set(items.map((i) => i.variant_id)))
  const { data: variants, error } = await admin
    .from('product_variants')
    .select(
      'id, is_active, is_pre_order, pre_order_available, inventory(quantity_available)',
    )
    .in('id', variantIds)
  if (error) throw error

  const availableById = new Map(
    variants.map((v) => [
      v.id,
      !v.is_active
        ? 0
        : v.is_pre_order
          ? v.pre_order_available
          : v.inventory.reduce((sum, inv) => sum + inv.quantity_available, 0),
    ]),
  )

  return items
    .map((item): CartStockIssue | null => {
      const available = Math.max(0, availableById.get(item.variant_id) ?? 0)
      if (available >= item.quantity) return null
      const label = [item.variant.size, item.variant.color, item.variant.style]
        .filter(Boolean)
        .join(' / ')
      return {
        cartItemId: item.id,
        productName: item.variant.product.name,
        productSlug: item.variant.product.slug,
        variantLabel: label || null,
        requestedQuantity: item.quantity,
        availableQuantity: available,
      }
    })
    .filter((issue): issue is CartStockIssue => issue !== null)
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

  const { discountId: attachedDiscountId, removedCode } =
    await detachUnredeemableDiscount(admin, cart.id, cart.discount_id)

  const [codeDiscount, cod, stockIssues] = await Promise.all([
    resolveDiscountForCart(admin, attachedDiscountId, items),
    resolveCodAvailability(admin, items),
    findCartStockIssues(admin, items),
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
    stockIssues,
    removedDiscountCode: removedCode,
  }
}

/**
 * A code stays attached to a cart (carts.discount_id) after it's applied,
 * but codes have end dates and usage caps — e.g. the email-capture welcome
 * code lasts 24h, so a shopper who applied it and came back a day later
 * used to keep seeing the discount in their totals, then get "This code has
 * expired" at Place Order (place-order.ts re-checks it). Instead, quietly
 * drop an unredeemable code from the cart as soon as it's loaded, so the
 * totals shown are always the totals charged. Also frees the cart for
 * resume.ts's abandoned-cart auto-apply, which only runs when no code is
 * attached. Returns the discount id still worth resolving (or null), and
 * the code just removed, if any.
 *
 * Cart-only on purpose: resolveDiscountForCart is also used to re-price an
 * existing order's items (admin/orders.ts), where the code was already
 * legitimately used and expiry since then mustn't strip it.
 */
async function detachUnredeemableDiscount(
  admin: Admin,
  cartId: string,
  discountId: string | null,
): Promise<{ discountId: string | null; removedCode: string | null }> {
  if (!discountId) return { discountId: null, removedCode: null }
  const { data: discount, error } = await admin
    .from('discounts')
    .select('*')
    .eq('id', discountId)
    .maybeSingle()
  if (error) throw error
  if (discount && isDiscountRedeemable(discount)) {
    return { discountId, removedCode: null }
  }

  const { error: detachError } = await admin
    .from('carts')
    .update({ discount_id: null })
    .eq('id', cartId)
    .eq('discount_id', discountId)
  if (detachError) throw detachError
  return { discountId: null, removedCode: discount?.code ?? null }
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

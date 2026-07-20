/**
 * Resolves what an active "automatic" discount (a Store sale or Collection
 * sale — see DiscountForm.tsx) is worth for a given product/variant, for
 * two different callers:
 *  - the storefront (product cards, collection pages, product detail) want
 *    a sale price to display next to the regular one;
 *  - the cart (src/server/cart/discount.ts) wants the same thing to reduce
 *    a checkout total without the customer entering a code.
 * Both need the exact same "which discount applies, and which one wins if
 * more than one does" logic, so it lives here once.
 */
import { resolveCollectionScopedProductIds } from '#/server/collections/scoped-products'
import type { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type { Discount } from '#/types/entities'

type Admin = ReturnType<typeof getSupabaseAdminClient>

export type AutomaticDiscount = Pick<
  Discount,
  | 'id'
  | 'code'
  | 'title'
  | 'type'
  | 'value'
  | 'scope'
  | 'scope_ids'
  | 'excluded_collection_ids'
>

/** Every currently-active automatic discount (Store sale or Collection sale) — active meaning is_active, and within its starts_at/ends_at window if either is set. Cheap: the discounts table only ever has a handful of automatic rows at once, so no pagination/caching here. */
export async function getActiveAutomaticDiscounts(
  admin: Admin,
): Promise<AutomaticDiscount[]> {
  const { data, error } = await admin
    .from('discounts')
    .select(
      'id, code, title, type, value, scope, scope_ids, excluded_collection_ids, starts_at, ends_at',
    )
    .eq('kind', 'automatic')
    .eq('is_active', true)
  if (error) throw error

  const now = Date.now()
  return data.filter((d) => {
    if (d.starts_at && new Date(d.starts_at).getTime() > now) return false
    if (d.ends_at && new Date(d.ends_at).getTime() < now) return false
    return true
  })
}

function discountAmountCents(
  discount: AutomaticDiscount,
  priceCents: number,
): number {
  if (discount.type === 'percentage') {
    return Math.round((priceCents * discount.value) / 100)
  }
  if (discount.type === 'fixed_amount') {
    return Math.min(discount.value, priceCents)
  }
  return 0
}

export interface ProductSale {
  discountId: string
  discountTitle: string
  salePriceCents: number
}

/**
 * The best active automatic discount for each product, given its regular
 * price — "best" meaning the lowest resulting sale price, so a Store sale
 * and a Collection sale both applying to the same product never stack.
 * Entries with no matching active discount are simply absent from the
 * returned map.
 *
 * `id` is what keys the returned map and what `priceCents` belongs to;
 * `productId` (defaults to `id`) is what collection membership is actually
 * checked against — lets a product detail page price each of a product's
 * variants individually (`id` = variant id, `productId` = the shared parent
 * product id) while a plain listing just prices products directly (`id` ===
 * `productId`, the default).
 */
export async function resolveSalePrices(
  admin: Admin,
  activeDiscounts: AutomaticDiscount[],
  items: { id: string; productId?: string; priceCents: number }[],
): Promise<Map<string, ProductSale>> {
  const result = new Map<string, ProductSale>()
  if (activeDiscounts.length === 0 || items.length === 0) return result

  const products = items.map((item) => ({
    ...item,
    productId: item.productId ?? item.id,
  }))
  const productIds = Array.from(new Set(products.map((p) => p.productId)))

  // One collection-membership resolution per discount (not per product) —
  // real usage is a handful of active sales at a time, so this stays cheap
  // regardless of how many products are being priced.
  const eligibleProductIdsByDiscount = new Map<string, Set<string>>()
  for (const discount of activeDiscounts) {
    if (discount.scope === 'all') {
      const excludedIds =
        discount.excluded_collection_ids.length > 0
          ? await resolveCollectionScopedProductIds(
              admin,
              discount.excluded_collection_ids,
              productIds,
            )
          : new Set<string>()
      eligibleProductIdsByDiscount.set(
        discount.id,
        new Set(productIds.filter((id) => !excludedIds.has(id))),
      )
    } else if (discount.scope === 'collection') {
      const included = await resolveCollectionScopedProductIds(
        admin,
        discount.scope_ids,
        productIds,
      )
      eligibleProductIdsByDiscount.set(discount.id, included)
    }
    // scope 'product'/'variant': not offered by the admin UI yet (only
    // 'all'/'collection' are), so nothing to resolve here — the cart's own
    // checkout-time discount code logic (src/server/cart/discount.ts)
    // still handles those scopes independently for discount codes.
  }

  for (const product of products) {
    let best: ProductSale | null = null
    for (const discount of activeDiscounts) {
      if (
        !eligibleProductIdsByDiscount.get(discount.id)?.has(product.productId)
      ) {
        continue
      }
      const amount = discountAmountCents(discount, product.priceCents)
      const salePriceCents = Math.max(0, product.priceCents - amount)
      if (!best || salePriceCents < best.salePriceCents) {
        best = {
          discountId: discount.id,
          discountTitle: discount.title,
          salePriceCents,
        }
      }
    }
    if (best) result.set(product.id, best)
  }

  return result
}

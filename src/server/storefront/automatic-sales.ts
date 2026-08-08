/**
 * Resolves what the active "automatic" discounts (Store sales and
 * Collection sales — see DiscountForm.tsx) are worth for a given
 * product/variant, for two different callers:
 *  - the storefront (product cards, collection pages, product detail) want
 *    a sale price to display next to the regular one;
 *  - the cart (src/server/cart/discount.ts) wants the same thing to reduce
 *    a checkout total without the customer entering a code.
 * Both need the exact same "which discounts apply, and how they combine
 * when more than one does" logic, so it lives here once. Every applicable
 * discount stacks (added together) — see resolveSalePrices' own doc
 * comment for why.
 */
import { resolveCollectionScopedProductIds } from '#/server/collections/scoped-products'
import type { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type { Discount } from '#/types/entities'
import { createPromiseCache } from '#/lib/utils/cache'

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
  | 'max_discounted_items'
  | 'excludes_free_shipping'
>

// Called on every single product-detail page view (and every listing page)
// to price each product — the discounts table itself only ever has a
// handful of active automatic rows at once, but re-fetching it per view adds
// up site-wide the same way storefront/maintenance.ts's flag did. Not
// brand-scoped, so a single fixed key.
const ACTIVE_AUTOMATIC_DISCOUNTS_CACHE_TTL_MS = 15_000
const activeAutomaticDiscountsCache = createPromiseCache<AutomaticDiscount[]>(
  ACTIVE_AUTOMATIC_DISCOUNTS_CACHE_TTL_MS,
)

/** Every currently-active automatic discount (Store sale or Collection sale) — active meaning is_active, and within its starts_at/ends_at window if either is set. */
export async function getActiveAutomaticDiscounts(
  admin: Admin,
): Promise<AutomaticDiscount[]> {
  return activeAutomaticDiscountsCache.get('default', async () => {
    const { data, error } = await admin
      .from('discounts')
      .select(
        'id, code, title, type, value, scope, scope_ids, excluded_collection_ids, max_discounted_items, excludes_free_shipping, starts_at, ends_at',
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
 * Every active automatic discount that applies to each product, given its
 * regular price, stacked together — a Store sale (scope 'all') and a
 * Collection sale (e.g. Clearance) both applying to the same product add
 * up rather than only the bigger one winning, since they're deliberately
 * scoped to different, separate collections rather than competing for the
 * same items (see resolveAutomaticDiscountsForCart in
 * src/server/cart/discount.ts, which mirrors this exact logic for
 * checkout). Entries with no matching active discount are simply absent
 * from the returned map.
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

  // Store-wide sale(s) first, so its title leads a combined "Store Sale +
  // Clearance" label the same way it leads the cart-side combined result.
  const ordered = [...activeDiscounts].sort((a, b) =>
    a.scope === b.scope ? 0 : a.scope === 'all' ? -1 : 1,
  )

  for (const product of products) {
    let totalAmountCents = 0
    let discountId: string | null = null
    let discountTitle = ''
    for (const discount of ordered) {
      if (
        !eligibleProductIdsByDiscount.get(discount.id)?.has(product.productId)
      ) {
        continue
      }
      const amount = discountAmountCents(discount, product.priceCents)
      if (amount <= 0) continue
      totalAmountCents += amount
      discountId ??= discount.id
      discountTitle = discountTitle
        ? `${discountTitle} + ${discount.title}`
        : discount.title
    }
    if (discountId) {
      result.set(product.id, {
        discountId,
        discountTitle,
        salePriceCents: Math.max(0, product.priceCents - totalAmountCents),
      })
    }
  }

  return result
}

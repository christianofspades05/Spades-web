/**
 * Resolves what the active "automatic" discounts (Store sales and
 * Collection sales — see DiscountForm.tsx) are worth for a given
 * product/variant, for two different callers:
 *  - the storefront (product cards, collection pages, product detail) want
 *    a sale price to display next to the regular one;
 *  - the cart (src/server/cart/discount.ts) wants the same thing to reduce
 *    a checkout total without the customer entering a code.
 * Both need the exact same "which discounts apply, and how they combine
 * when more than one does" logic, so it lives here once.
 *
 * A Store sale (scope 'all') and any Collection sale marked
 * stacks_with_sale add together for a product eligible for both. A
 * Collection sale NOT marked stacks_with_sale (the default — e.g.
 * Clearance) is exclusive instead: a product in that collection gets only
 * that sale's own rate, full stop, ignoring the store-wide sale entirely
 * for that product — see resolveSalePrices' own doc comment for why.
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
  | 'stacks_with_sale'
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

async function fetchActiveAutomaticDiscounts(
  admin: Admin,
): Promise<AutomaticDiscount[]> {
  const { data, error } = await admin
    .from('discounts')
    .select(
      'id, code, title, type, value, scope, scope_ids, excluded_collection_ids, max_discounted_items, excludes_free_shipping, stacks_with_sale, starts_at, ends_at',
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

/** Every currently-active automatic discount (Store sale or Collection sale) — active meaning is_active, and within its starts_at/ends_at window if either is set. */
export async function getActiveAutomaticDiscounts(
  admin: Admin,
): Promise<AutomaticDiscount[]> {
  return activeAutomaticDiscountsCache.get('default', () =>
    fetchActiveAutomaticDiscounts(admin),
  )
}

/** Same as getActiveAutomaticDiscounts but bypasses the 15s cache — for
 *  callers where staleness right after a discount write would be wrong
 *  (the marketplace price-sync job in sync-engine.ts runs synchronously
 *  right after an admin discount save and must reflect it immediately,
 *  not whatever was cached up to 15s ago). */
export async function getActiveAutomaticDiscountsFresh(
  admin: Admin,
): Promise<AutomaticDiscount[]> {
  return fetchActiveAutomaticDiscounts(admin)
}

/** Splits active automatic discounts into "additive" (a store-wide sale,
 *  or a collection sale explicitly marked stacks_with_sale) and
 *  "exclusive" (a collection sale that isn't — the default, e.g.
 *  Clearance) — shared by both resolveSalePrices below and
 *  src/server/cart/discount.ts's cart-side equivalent. */
export function splitAdditiveAndExclusiveDiscounts(
  activeDiscounts: AutomaticDiscount[],
): { additive: AutomaticDiscount[]; exclusive: AutomaticDiscount[] } {
  const additive: AutomaticDiscount[] = []
  const exclusive: AutomaticDiscount[] = []
  for (const discount of activeDiscounts) {
    if (discount.scope === 'all' || discount.stacks_with_sale) {
      additive.push(discount)
    } else {
      exclusive.push(discount)
    }
  }
  return { additive, exclusive }
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
 * regular price. A product in a non-stacking Collection sale (e.g.
 * Clearance) gets ONLY that sale's own rate — the store-wide sale is
 * ignored entirely for that product, full stop. Everything else (the
 * store-wide sale, plus any Collection sale explicitly marked
 * stacks_with_sale) adds together. See splitAdditiveAndExclusiveDiscounts'
 * doc comment, and resolveAutomaticDiscountsForCart in
 * src/server/cart/discount.ts, which mirrors this exact logic for
 * checkout. Entries with no matching active discount are simply absent
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
  // regardless of how many products are being priced. Run concurrently
  // rather than one discount after another — each was its own DB round
  // trip, and on a cold serverless instance those added up into a real,
  // avoidable chunk of a product page's slow first hit.
  const eligibleProductIdsByDiscount = new Map<string, Set<string>>()
  await Promise.all(
    activeDiscounts.map(async (discount) => {
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
      // 'all'/'collection' are), so nothing to resolve here — the cart's
      // own checkout-time discount code logic (src/server/cart/discount.ts)
      // still handles those scopes independently for discount codes.
    }),
  )

  const { additive, exclusive } = splitAdditiveAndExclusiveDiscounts(activeDiscounts)

  for (const product of products) {
    let exclusiveBest: ProductSale | null = null
    for (const discount of exclusive) {
      if (!eligibleProductIdsByDiscount.get(discount.id)?.has(product.productId)) {
        continue
      }
      const amountCents = discountAmountCents(discount, product.priceCents)
      if (amountCents <= 0) continue
      if (!exclusiveBest || amountCents > product.priceCents - exclusiveBest.salePriceCents) {
        exclusiveBest = {
          discountId: discount.id,
          discountTitle: discount.title,
          salePriceCents: Math.max(0, product.priceCents - amountCents),
        }
      }
    }
    if (exclusiveBest) {
      result.set(product.id, exclusiveBest)
      continue
    }

    let totalAmountCents = 0
    let discountId: string | null = null
    let discountTitle = ''
    for (const discount of additive) {
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

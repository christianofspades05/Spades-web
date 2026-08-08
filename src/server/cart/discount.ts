/**
 * Cart-side discount code preview. This only computes and stores which
 * discount is attached to a cart (carts.discount_id) and how much it's
 * currently worth — it never touches discounts.times_used. Actual redemption
 * (incrementing usage, locking the amount in) happens at checkout, which
 * isn't built yet.
 */
import { resolveCollectionScopedProductIds } from '#/server/collections/scoped-products'
import {
  getActiveAutomaticDiscounts,
  splitAdditiveAndExclusiveDiscounts,
} from '#/server/storefront/automatic-sales'
import { formatCentsAsPHP } from '#/lib/utils/money'
import type { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type { CartItemWithVariant, Discount } from '#/types/entities'

type Admin = ReturnType<typeof getSupabaseAdminClient>

export interface AppliedCartDiscount {
  id: string
  code: string | null
  title: string
  type: Discount['type']
  value: number
  /** Total discount amount — includes every stacked discount's amount too,
   *  when stackedWith below is non-empty. Everything that subtracts a
   *  discount from a total (checkout, the cart summary) should use this
   *  one field. */
  amountCents: number
  /** True if this discount should always charge normal shipping — see
   *  discounts.excludes_free_shipping. Checked by shippingCostCents'
   *  callers, never by this module itself. */
  excludesFreeShipping: boolean
  /** How much each cart item actually got knocked off, summed across every
   *  stacked discount that applies to it — only present for items with at
   *  least one discounted unit (a cart item entirely outside every
   *  discount's scope, or fully excluded by max_discounted_items, just
   *  doesn't appear here). Tracked per item (not just as one combined
   *  percentage) specifically because two stacked discounts can cover
   *  different, non-identical subsets of the cart — e.g. a store-wide sale
   *  applies to every item while a Clearance collection sale only applies
   *  to items actually in that collection, so a non-clearance item must
   *  only ever show the store-wide sale's own cut, never the combined
   *  rate. Lets the cart/checkout UI show e.g. "discount applies to 2 of
   *  4" and a real "was ₱X, now ₱Y" per line, both correctly scoped. */
  itemBreakdown: {
    cartItemId: string
    discountedUnits: number
    discountedAmountCents: number
  }[]
  /** Every other discount stacked on top of this one — e.g. a Clearance
   *  collection sale stacking on top of an active store-wide sale (see
   *  resolveAutomaticDiscountsForCart), or a code marked
   *  discounts.stacks_with_sale stacking on top of an active store-wide
   *  sale (see resolveDiscountForCart). Empty when nothing else applies.
   *  `type`/`value` are the stacked discount's own rate — e.g. so the cart
   *  can show "15% off + Clearance Sale (40% off)" instead of one
   *  (potentially inaccurate, since the two may not share eligible items)
   *  combined percentage. */
  stackedWith: {
    title: string
    amountCents: number
    type: Discount['type']
    value: number
  }[]
}

function itemLineTotalCents(item: CartItemWithVariant): number {
  return item.quantity * item.price_cents_snapshot
}

/** The individual units (one entry per unit, not per line) a
 *  percentage/fixed_amount discount actually applies to, and their combined
 *  value — every eligible unit, unless maxDiscountedItems caps it to only
 *  the N highest-priced units (the owner's choice: a capped code discounts
 *  the customer's priciest picks first, full price on the rest). Ties
 *  (equal-priced units from different items) are broken by `eligible`'s own
 *  order, via a stable sort. */
function discountableBreakdown(
  eligible: CartItemWithVariant[],
  maxDiscountedItems: number | null,
): { subtotalCents: number; units: { cartItemId: string; priceCents: number }[] } {
  const allUnits: { cartItemId: string; priceCents: number }[] = []
  for (const item of eligible) {
    for (let i = 0; i < item.quantity; i++) {
      allUnits.push({ cartItemId: item.id, priceCents: item.price_cents_snapshot })
    }
  }
  if (maxDiscountedItems == null) {
    return {
      subtotalCents: allUnits.reduce((sum, unit) => sum + unit.priceCents, 0),
      units: allUnits,
    }
  }
  allUnits.sort((a, b) => b.priceCents - a.priceCents)
  const units = allUnits.slice(0, maxDiscountedItems)
  return {
    subtotalCents: units.reduce((sum, unit) => sum + unit.priceCents, 0),
    units,
  }
}

async function eligibleItemsForDiscount(
  admin: Admin,
  discount: Pick<Discount, 'scope' | 'scope_ids'>,
  items: CartItemWithVariant[],
): Promise<CartItemWithVariant[]> {
  if (discount.scope === 'all') return items

  if (discount.scope === 'variant') {
    return items.filter((item) => discount.scope_ids.includes(item.variant_id))
  }

  if (discount.scope === 'product') {
    return items.filter((item) =>
      discount.scope_ids.includes(item.variant.product.id),
    )
  }

  // scope === 'collection': eligible if the product is manually pinned to
  // one of the scoped collections, or matches one of their auto-match rules.
  const productIds = Array.from(
    new Set(items.map((item) => item.variant.product.id)),
  )
  if (productIds.length === 0) return []

  const eligibleProductIds = await resolveCollectionScopedProductIds(
    admin,
    discount.scope_ids,
    productIds,
  )

  return items.filter((item) => eligibleProductIds.has(item.variant.product.id))
}

async function appliedDiscountFor(
  admin: Admin,
  discount: Pick<
    Discount,
    | 'id'
    | 'code'
    | 'title'
    | 'type'
    | 'value'
    | 'scope'
    | 'scope_ids'
    | 'max_discounted_items'
    | 'excludes_free_shipping'
  >,
  items: CartItemWithVariant[],
): Promise<AppliedCartDiscount | null> {
  const eligible = await eligibleItemsForDiscount(admin, discount, items)
  if (eligible.length === 0) return null
  const { subtotalCents: eligibleSubtotalCents, units } = discountableBreakdown(
    eligible,
    discount.max_discounted_items,
  )

  let amountCents = 0
  if (discount.type === 'percentage') {
    amountCents = Math.round((eligibleSubtotalCents * discount.value) / 100)
  } else if (discount.type === 'fixed_amount') {
    amountCents = Math.min(discount.value, eligibleSubtotalCents)
  }
  if (amountCents <= 0) return null

  // Per-unit for a percentage discount (exact — every unit drops by the
  // same rate). A fixed_amount discount's one flat capped amount doesn't
  // belong to any single unit, so it's allocated proportionally to each
  // unit's own price instead.
  const perItem = new Map<
    string,
    { discountedUnits: number; discountedAmountCents: number }
  >()
  for (const unit of units) {
    const unitAmountCents =
      discount.type === 'percentage'
        ? Math.round((unit.priceCents * discount.value) / 100)
        : Math.round((amountCents * unit.priceCents) / eligibleSubtotalCents)
    const entry = perItem.get(unit.cartItemId) ?? {
      discountedUnits: 0,
      discountedAmountCents: 0,
    }
    entry.discountedUnits += 1
    entry.discountedAmountCents += unitAmountCents
    perItem.set(unit.cartItemId, entry)
  }

  return {
    id: discount.id,
    code: discount.code,
    title: discount.title,
    type: discount.type,
    value: discount.value,
    amountCents,
    excludesFreeShipping: discount.excludes_free_shipping,
    stackedWith: [],
    itemBreakdown: Array.from(perItem, ([cartItemId, entry]) => ({
      cartItemId,
      ...entry,
    })),
  }
}

type ItemBreakdownEntry = {
  cartItemId: string
  discountedUnits: number
  discountedAmountCents: number
}

/**
 * Combines a set of "additive" discounts (store-wide sales, and any
 * collection sale explicitly marked stacks_with_sale) with a set of
 * "exclusive" discounts (a collection sale that isn't — e.g. Clearance)
 * into one result. An item covered by an exclusive discount uses ONLY the
 * best exclusive discount's own amount for that item, full stop — the
 * store-wide sale (and any additive collection sale) never touches it,
 * which is the whole point of leaving a collection sale off
 * stacks_with_sale. Every other item sums every additive discount that
 * applies to it. See splitAdditiveAndExclusiveDiscounts (in
 * server/storefront/automatic-sales.ts) for how the split itself is
 * decided.
 */
async function combineAdditiveAndExclusiveDiscounts(
  admin: Admin,
  items: CartItemWithVariant[],
  additiveDiscounts: Pick<
    Discount,
    | 'id'
    | 'code'
    | 'title'
    | 'type'
    | 'value'
    | 'scope'
    | 'scope_ids'
    | 'max_discounted_items'
    | 'excludes_free_shipping'
  >[],
  exclusiveDiscounts: Pick<
    Discount,
    | 'id'
    | 'code'
    | 'title'
    | 'type'
    | 'value'
    | 'scope'
    | 'scope_ids'
    | 'max_discounted_items'
    | 'excludes_free_shipping'
  >[],
): Promise<AppliedCartDiscount | null> {
  const appliedAdditive: AppliedCartDiscount[] = []
  for (const discount of additiveDiscounts) {
    const applied = await appliedDiscountFor(admin, discount, items)
    if (applied) appliedAdditive.push(applied)
  }
  const appliedExclusive: AppliedCartDiscount[] = []
  for (const discount of exclusiveDiscounts) {
    const applied = await appliedDiscountFor(admin, discount, items)
    if (applied) appliedExclusive.push(applied)
  }
  if (appliedAdditive.length === 0 && appliedExclusive.length === 0) return null

  const exclusiveByItem = new Map<string, ItemBreakdownEntry>()
  for (const applied of appliedExclusive) {
    for (const entry of applied.itemBreakdown) {
      const existing = exclusiveByItem.get(entry.cartItemId)
      if (!existing || entry.discountedAmountCents > existing.discountedAmountCents) {
        exclusiveByItem.set(entry.cartItemId, entry)
      }
    }
  }

  const additiveByItem = new Map<string, ItemBreakdownEntry>()
  for (const applied of appliedAdditive) {
    for (const entry of applied.itemBreakdown) {
      if (exclusiveByItem.has(entry.cartItemId)) continue
      const existing = additiveByItem.get(entry.cartItemId) ?? {
        cartItemId: entry.cartItemId,
        discountedUnits: 0,
        discountedAmountCents: 0,
      }
      additiveByItem.set(entry.cartItemId, {
        cartItemId: entry.cartItemId,
        discountedUnits: Math.max(existing.discountedUnits, entry.discountedUnits),
        discountedAmountCents:
          existing.discountedAmountCents + entry.discountedAmountCents,
      })
    }
  }

  // Safety clamp: two additive percentage discounts can in principle sum
  // past 100% for a single item (e.g. 60% + 50%) — cap each item's total
  // cut at its own line total so that never produces a negative price.
  const lineTotalCentsByItem = new Map(
    items.map((item) => [item.id, itemLineTotalCents(item)]),
  )
  const itemBreakdown = [...exclusiveByItem.values(), ...additiveByItem.values()].map(
    (entry) => ({
      ...entry,
      discountedAmountCents: Math.min(
        entry.discountedAmountCents,
        lineTotalCentsByItem.get(entry.cartItemId) ?? entry.discountedAmountCents,
      ),
    }),
  )
  if (itemBreakdown.length === 0) return null

  const amountCents = itemBreakdown.reduce(
    (sum, entry) => sum + entry.discountedAmountCents,
    0,
  )

  const allApplied = [...appliedAdditive, ...appliedExclusive]
  // A customer-entered code always leads as the combined result's identity
  // when one's involved — it's the one explicit action the customer took.
  // Otherwise the discount contributing the most leads (typically the
  // store-wide sale, since it's usually the broadest).
  const primary =
    allApplied.find((applied) => applied.code != null) ??
    allApplied.reduce((best, applied) =>
      applied.amountCents > best.amountCents ? applied : best,
    )
  const stackedWith = allApplied
    .filter((applied) => applied.id !== primary.id)
    .map((applied) => ({
      title: applied.title,
      amountCents: applied.amountCents,
      type: applied.type,
      value: applied.value,
    }))

  return { ...primary, amountCents, stackedWith, itemBreakdown }
}

/**
 * Recomputes what a cart's already-attached discount code is currently
 * worth. Whether it stacks with an active store-wide sale is decided by
 * the SALE's own stacks_with_sale setting (see DiscountForm.tsx's "Allow
 * discount codes to also apply on top of this sale") — not by the code —
 * so a store owner flips it once per sale rather than editing every
 * individual code. When no active store-wide sale allows it, the code
 * simply replaces every additive automatic discount outright, same as
 * always ("a code the customer typed in always wins"). Either way, an
 * exclusive collection sale (e.g. Clearance) stays untouched: an item in
 * that collection keeps its own flat collection-sale rate regardless of
 * any code — see combineAdditiveAndExclusiveDiscounts.
 */
export async function resolveDiscountForCart(
  admin: Admin,
  discountId: string | null,
  items: CartItemWithVariant[],
): Promise<AppliedCartDiscount | null> {
  if (!discountId) return null

  const { data: discount, error } = await admin
    .from('discounts')
    .select('*')
    .eq('id', discountId)
    .maybeSingle()
  if (error) throw error
  if (!discount || !discount.is_active) return null

  const activeAutomaticDiscounts = await getActiveAutomaticDiscounts(admin)
  const { additive, exclusive } = splitAdditiveAndExclusiveDiscounts(
    activeAutomaticDiscounts,
  )
  const activeSaleAllowsCodeStacking = additive.some(
    (d) => d.scope === 'all' && d.stacks_with_sale,
  )
  return combineAdditiveAndExclusiveDiscounts(
    admin,
    items,
    activeSaleAllowsCodeStacking ? [discount, ...additive] : [discount],
    exclusive,
  )
}

/**
 * A cart with no customer-entered code still gets every active automatic
 * discount that applies, combined the same way a code stacking onto a sale
 * does — see combineAdditiveAndExclusiveDiscounts. Never persisted to
 * carts.discount_id since eligibility can shift as the cart's contents
 * change, unlike a code the customer explicitly typed in.
 */
export async function resolveAutomaticDiscountsForCart(
  admin: Admin,
  items: CartItemWithVariant[],
): Promise<AppliedCartDiscount | null> {
  if (items.length === 0) return null
  const activeDiscounts = await getActiveAutomaticDiscounts(admin)
  if (activeDiscounts.length === 0) return null

  const { additive, exclusive } = splitAdditiveAndExclusiveDiscounts(activeDiscounts)
  return combineAdditiveAndExclusiveDiscounts(admin, items, additive, exclusive)
}

/** Throws a user-facing message if a discount is inactive, outside its date window, or has hit its usage cap. Shared by the cart-apply step and the final checkout re-check. */
export function assertDiscountIsRedeemable(discount: Discount): void {
  if (!discount.is_active) {
    throw new Error('Invalid discount code')
  }

  const now = new Date()
  if (discount.starts_at && new Date(discount.starts_at) > now) {
    throw new Error('This code is not active yet')
  }
  if (discount.ends_at && new Date(discount.ends_at) < now) {
    throw new Error('This code has expired')
  }
  if (discount.max_uses != null && discount.times_used >= discount.max_uses) {
    throw new Error('This code has reached its usage limit')
  }
}

/** Validates a customer-entered code against a cart's current contents. Throws a user-facing message on failure. */
export async function findValidDiscountByCode(
  admin: Admin,
  code: string,
  items: CartItemWithVariant[],
): Promise<Discount> {
  const { data: discount, error } = await admin
    .from('discounts')
    .select('*')
    .eq('code', code.trim().toUpperCase())
    .eq('kind', 'code')
    .maybeSingle()
  if (error) throw error
  if (!discount) {
    throw new Error('Invalid discount code')
  }
  assertDiscountIsRedeemable(discount)

  const subtotalCents = items.reduce(
    (sum, item) => sum + itemLineTotalCents(item),
    0,
  )
  if (subtotalCents < discount.min_subtotal_cents) {
    throw new Error(
      `This code requires a minimum order of ${formatCentsAsPHP(discount.min_subtotal_cents)}`,
    )
  }

  if (discount.scope !== 'all') {
    const eligible = await eligibleItemsForDiscount(admin, discount, items)
    if (eligible.length === 0) {
      throw new Error("This code doesn't apply to items in your cart")
    }
  }

  return discount
}

/**
 * Cart-side discount code preview. This only computes and stores which
 * discount is attached to a cart (carts.discount_id) and how much it's
 * currently worth — it never touches discounts.times_used. Actual redemption
 * (incrementing usage, locking the amount in) happens at checkout, which
 * isn't built yet.
 */
import { resolveCollectionScopedProductIds } from '#/server/collections/scoped-products'
import { getActiveAutomaticDiscounts } from '#/server/storefront/automatic-sales'
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

/** Combines two discounts' per-item breakdowns — discountedAmountCents adds
 *  up (a unit genuinely gets both cuts when both discounts actually apply
 *  to it), while discountedUnits takes whichever is higher (it's just a
 *  unit *count* for the "applies to X of Y" hint, not a currency amount, so
 *  a unit discounted by both should still count once, not twice). Critically,
 *  an item that only ONE of the two discounts covers (e.g. a non-clearance
 *  item under a store-wide-sale-only + Clearance-sale stack) only picks up
 *  that one discount's amount here — never the other's, since it's simply
 *  absent from that discount's own breakdown. */
function mergeItemBreakdowns(
  a: {
    cartItemId: string
    discountedUnits: number
    discountedAmountCents: number
  }[],
  b: {
    cartItemId: string
    discountedUnits: number
    discountedAmountCents: number
  }[],
): {
  cartItemId: string
  discountedUnits: number
  discountedAmountCents: number
}[] {
  const merged = new Map<
    string,
    { discountedUnits: number; discountedAmountCents: number }
  >()
  for (const entry of [...a, ...b]) {
    const existing = merged.get(entry.cartItemId) ?? {
      discountedUnits: 0,
      discountedAmountCents: 0,
    }
    merged.set(entry.cartItemId, {
      discountedUnits: Math.max(existing.discountedUnits, entry.discountedUnits),
      discountedAmountCents:
        existing.discountedAmountCents + entry.discountedAmountCents,
    })
  }
  return Array.from(merged, ([cartItemId, entry]) => ({ cartItemId, ...entry }))
}

/** Adds `extra` on top of `primary`, additively — the shared math behind
 *  every kind of stacking this module does (a code stacking onto a
 *  store-wide sale, or a Clearance collection sale stacking onto a
 *  store-wide sale). `primary` keeps its own id/code/title as the combined
 *  result's identity; `extra` just contributes its amount and shows up in
 *  stackedWith. The per-item breakdown merge (not a flat combined
 *  percentage) is what keeps this correct when `primary` and `extra` don't
 *  cover the exact same cart items — see mergeItemBreakdowns. */
function combineAppliedDiscounts(
  primary: AppliedCartDiscount,
  extra: AppliedCartDiscount,
  cartTotalCents: number,
): AppliedCartDiscount {
  return {
    ...primary,
    amountCents: Math.min(
      primary.amountCents + extra.amountCents,
      cartTotalCents,
    ),
    stackedWith: [
      ...primary.stackedWith,
      {
        title: extra.title,
        amountCents: extra.amountCents,
        type: extra.type,
        value: extra.value,
      },
    ],
    itemBreakdown: mergeItemBreakdowns(
      primary.itemBreakdown,
      extra.itemBreakdown,
    ),
  }
}

/** Recomputes what a cart's already-attached discount (if any) is currently
 *  worth — and, if that discount is marked stacks_with_sale, adds in
 *  whatever active store-wide (scope 'all') automatic sale also applies.
 *  Deliberately never stacks with a collection-scoped sale (e.g.
 *  Clearance) even if one is active — see discounts.stacks_with_sale's own
 *  migration comment. */
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

  const applied = await appliedDiscountFor(admin, discount, items)
  if (!applied || !discount.stacks_with_sale) return applied

  const activeAutomaticDiscounts = await getActiveAutomaticDiscounts(admin)
  const storeWideSale = activeAutomaticDiscounts.find((d) => d.scope === 'all')
  if (!storeWideSale) return applied

  const saleApplied = await appliedDiscountFor(admin, storeWideSale, items)
  if (!saleApplied) return applied

  const cartTotalCents = items.reduce(
    (sum, item) => sum + itemLineTotalCents(item),
    0,
  )
  return combineAppliedDiscounts(applied, saleApplied, cartTotalCents)
}

/**
 * A cart with no customer-entered code still gets every active automatic
 * discount that applies to at least one item, all stacked together — e.g.
 * a store-wide sale and a Clearance collection sale both apply at once to
 * a clearance product, since they're deliberately scoped to different,
 * separate collections rather than competing for the same items. Never
 * persisted to carts.discount_id since eligibility can shift as the cart's
 * contents change, unlike a code the customer explicitly typed in.
 *
 * The store-wide sale (if one is active) always leads as the combined
 * result's id/title/code — matches how discounts.stacks_with_sale codes
 * key their own stacking eligibility purely off "is a store-wide sale
 * active," regardless of what collection sales are also running.
 */
export async function resolveAutomaticDiscountsForCart(
  admin: Admin,
  items: CartItemWithVariant[],
): Promise<AppliedCartDiscount | null> {
  if (items.length === 0) return null
  const activeDiscounts = await getActiveAutomaticDiscounts(admin)
  if (activeDiscounts.length === 0) return null

  const ordered = [...activeDiscounts].sort((a, b) =>
    a.scope === b.scope ? 0 : a.scope === 'all' ? -1 : 1,
  )

  const cartTotalCents = items.reduce(
    (sum, item) => sum + itemLineTotalCents(item),
    0,
  )

  let combined: AppliedCartDiscount | null = null
  for (const discount of ordered) {
    const applied = await appliedDiscountFor(admin, discount, items)
    if (!applied) continue
    combined = combined
      ? combineAppliedDiscounts(combined, applied, cartTotalCents)
      : applied
  }
  return combined
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

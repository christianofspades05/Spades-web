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
import type { AutomaticDiscount } from '#/server/storefront/automatic-sales'
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
  /** Set only for a creator (affiliate) code — see resolveAffiliateCode.
   *  Which lines got the sale rate vs the code's normal rate, and the
   *  commission each earns, for the cart message and the order's per-line
   *  commission snapshot. */
  affiliate?: AffiliateCodeRates
}

export interface AffiliateCodeRates {
  code: string
  normalPercent: number
  salePercent: number
  normalCommissionBps: number
  saleCommissionBps: number
  /** Cart item ids already on sale — they get salePercent/saleCommissionBps. */
  saleItemIds: string[]
  /** Cart item ids at full price — normalPercent/normalCommissionBps. */
  normalItemIds: string[]
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
): {
  subtotalCents: number
  units: { cartItemId: string; priceCents: number }[]
} {
  const allUnits: { cartItemId: string; priceCents: number }[] = []
  for (const item of eligible) {
    for (let i = 0; i < item.quantity; i++) {
      allUnits.push({
        cartItemId: item.id,
        priceCents: item.price_cents_snapshot,
      })
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

export function eligibleUnitCount(items: CartItemWithVariant[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0)
}

export async function eligibleItemsForDiscount(
  admin: Admin,
  discount: Pick<Discount, 'scope' | 'scope_ids' | 'excluded_collection_ids'>,
  items: CartItemWithVariant[],
): Promise<CartItemWithVariant[]> {
  if (discount.scope === 'all') {
    // A store-wide sale's excluded collections (see DiscountForm's "Exclude
    // collections from this sale") must be left out here too, matching
    // resolveSalePrices on the storefront — otherwise an excluded item
    // shows full price on its product page but still gets the sale in the
    // cart.
    if (discount.excluded_collection_ids.length === 0) return items
    const productIds = Array.from(
      new Set(items.map((item) => item.variant.product.id)),
    )
    if (productIds.length === 0) return []
    const excludedProductIds = await resolveCollectionScopedProductIds(
      admin,
      discount.excluded_collection_ids,
      productIds,
    )
    return items.filter(
      (item) => !excludedProductIds.has(item.variant.product.id),
    )
  }

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
    | 'excluded_collection_ids'
    | 'max_discounted_items'
    | 'excludes_free_shipping'
    | 'min_quantity'
  >,
  items: CartItemWithVariant[],
): Promise<AppliedCartDiscount | null> {
  const eligible = await eligibleItemsForDiscount(admin, discount, items)
  if (eligible.length === 0) return null
  // Bundle deal: only applies once the cart holds enough eligible items.
  if (
    discount.min_quantity != null &&
    eligibleUnitCount(eligible) < discount.min_quantity
  ) {
    return null
  }
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
    | 'excluded_collection_ids'
    | 'max_discounted_items'
    | 'excludes_free_shipping'
    | 'min_quantity'
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
    | 'excluded_collection_ids'
    | 'max_discounted_items'
    | 'excludes_free_shipping'
    | 'min_quantity'
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
      if (
        !existing ||
        entry.discountedAmountCents > existing.discountedAmountCents
      ) {
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
        discountedUnits: Math.max(
          existing.discountedUnits,
          entry.discountedUnits,
        ),
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
  const itemBreakdown = [
    ...exclusiveByItem.values(),
    ...additiveByItem.values(),
  ].map((entry) => ({
    ...entry,
    discountedAmountCents: Math.min(
      entry.discountedAmountCents,
      lineTotalCentsByItem.get(entry.cartItemId) ?? entry.discountedAmountCents,
    ),
  }))
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
    allApplied.find(
      (applied) =>
        applied.code != null &&
        applied.itemBreakdown.some(
          (entry) =>
            !exclusiveByItem.has(entry.cartItemId) &&
            entry.discountedAmountCents > 0,
        ),
    ) ??
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
interface CreatorAssignmentRates {
  commission_bps: number
  sale_discount_percent: number
  sale_commission_bps: number
}

/** Throws unless a creator code can be used on this store; returns the
 *  code's assignment (its rates), or null for a non-creator code. */
async function assertCreatorCodeEligible(
  admin: Admin,
  discountId: string,
): Promise<CreatorAssignmentRates | null> {
  const { data: assignment, error } = await admin
    .from('creator_discount_assignments')
    .select(
      'creator_id, brand, is_active, commission_bps, sale_discount_percent, sale_commission_bps',
    )
    .eq('discount_id', discountId)
    .maybeSingle()
  if (error) throw error
  if (!assignment) return null
  const { getStorefrontScope } = await import('#/server/storefront/domain')
  const scope = await getStorefrontScope()
  const { data: creator, error: creatorError } = await admin
    .from('creators')
    .select('is_active')
    .eq('id', assignment.creator_id)
    .single()
  if (creatorError) throw creatorError
  if (
    !assignment.is_active ||
    !creator.is_active ||
    assignment.brand !== scope.brand
  )
    throw new Error('This creator code is not available on this store')
  return {
    commission_bps: assignment.commission_bps,
    sale_discount_percent: Number(assignment.sale_discount_percent),
    sale_commission_bps: assignment.sale_commission_bps,
  }
}

/** A line counts as on sale when a store-wide or collection sale already
 *  discounts it, or it's marked down against a compare-at price — the same
 *  sales that, for other codes, decide whether the code replaces the sale. */
export function isLineOnSale(
  item: CartItemWithVariant,
  saleAmountCents: number,
): boolean {
  if (saleAmountCents > 0) return true
  const compareAt = item.variant.compare_at_price_cents
  return compareAt != null && compareAt > item.price_cents_snapshot
}

/**
 * Affiliate code "sale mode". The code always applies on top of whatever
 * automatic sales the cart already gets: lines already on sale get an extra
 * `sale_discount_percent` (default 1%) of their sale price, full-price
 * lines get the code's own value (e.g. 10%). Commission follows the same
 * split (sale_commission_bps vs commission_bps) and is snapshotted per
 * order line at checkout. Bundle deals stay on only when their own "codes
 * can stack" switch is on, same as for any other code.
 */
export async function resolveAffiliateCode(
  admin: Admin,
  discount: Discount,
  rates: CreatorAssignmentRates,
  items: CartItemWithVariant[],
  additive: AutomaticDiscount[],
  exclusive: AutomaticDiscount[],
): Promise<AppliedCartDiscount | null> {
  // Bundle and free gift deals (min_quantity set) aren't "sales" here.
  const sales = additive.filter((d) => d.min_quantity == null)
  const stackingBundles = additive.filter(
    (d) => d.min_quantity != null && d.stacks_with_sale,
  )

  const [saleOnly, automatic] = await Promise.all([
    combineAdditiveAndExclusiveDiscounts(admin, items, sales, exclusive),
    combineAdditiveAndExclusiveDiscounts(
      admin,
      items,
      [...sales, ...stackingBundles],
      exclusive,
    ),
  ])
  const amountFor = (result: AppliedCartDiscount | null, itemId: string) =>
    result?.itemBreakdown.find((e) => e.cartItemId === itemId)
      ?.discountedAmountCents ?? 0

  const saleItemIds: string[] = []
  const normalItemIds: string[] = []
  const itemBreakdown: ItemBreakdownEntry[] = []
  let amountCents = 0
  let codeAmountCents = 0
  for (const item of items) {
    const lineTotal = itemLineTotalCents(item)
    const automaticCents = Math.min(amountFor(automatic, item.id), lineTotal)
    const onSale = isLineOnSale(item, amountFor(saleOnly, item.id))
    ;(onSale ? saleItemIds : normalItemIds).push(item.id)
    const percent = onSale ? rates.sale_discount_percent : discount.value
    const codeCents = Math.round(((lineTotal - automaticCents) * percent) / 100)
    const lineCents = Math.min(lineTotal, automaticCents + codeCents)
    codeAmountCents += lineCents - automaticCents
    amountCents += lineCents
    if (lineCents > 0) {
      itemBreakdown.push({
        cartItemId: item.id,
        discountedUnits: item.quantity,
        discountedAmountCents: lineCents,
      })
    }
  }

  const stackedWith: AppliedCartDiscount['stackedWith'] = []
  if (automatic) {
    const othersCents = automatic.stackedWith.reduce(
      (sum, s) => sum + s.amountCents,
      0,
    )
    stackedWith.push(
      {
        title: automatic.title,
        amountCents: Math.max(0, automatic.amountCents - othersCents),
        type: automatic.type,
        value: automatic.value,
      },
      ...automatic.stackedWith,
    )
  }
  if (amountCents <= 0 || codeAmountCents <= 0) {
    // Nothing for the code to add (e.g. everything already free) — still
    // report the sales so the cart total stays right.
    if (!automatic) return null
  }

  return {
    id: discount.id,
    code: discount.code,
    title: discount.title,
    type: discount.type,
    value: discount.value,
    amountCents,
    excludesFreeShipping: discount.excludes_free_shipping,
    stackedWith,
    itemBreakdown,
    affiliate: {
      code: discount.code ?? discount.title,
      normalPercent: discount.value,
      salePercent: rates.sale_discount_percent,
      normalCommissionBps: rates.commission_bps,
      saleCommissionBps: rates.sale_commission_bps,
      saleItemIds,
      normalItemIds,
    },
  }
}

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
  const creatorRates = await assertCreatorCodeEligible(admin, discount.id)

  const activeAutomaticDiscounts = await getActiveAutomaticDiscounts(admin)
  const { additive, exclusive } = splitAdditiveAndExclusiveDiscounts(
    activeAutomaticDiscounts,
  )

  // Affiliate codes always apply, sale or not (sale mode) — every other
  // code keeps the stacking rules below.
  if (
    creatorRates &&
    discount.type === 'percentage' &&
    discount.scope === 'all'
  ) {
    return resolveAffiliateCode(
      admin,
      discount,
      creatorRates,
      items,
      additive,
      exclusive,
    )
  }
  // Bundle deals carry their own "codes can stack on top" switch, so they're
  // decided separately from regular sales: a bundle that allows it stays
  // alongside the code; one that doesn't is replaced by the code.
  const bundles = additive.filter((d) => d.min_quantity != null)
  const sales = additive.filter((d) => d.min_quantity == null)
  const activeSaleAllowsCodeStacking = sales.some(
    (d) => d.scope === 'all' && d.stacks_with_sale,
  )
  return combineAdditiveAndExclusiveDiscounts(
    admin,
    items,
    [
      discount,
      ...(activeSaleAllowsCodeStacking ? sales : []),
      ...bundles.filter((d) => d.stacks_with_sale),
    ],
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

  const { additive, exclusive } =
    splitAdditiveAndExclusiveDiscounts(activeDiscounts)
  return combineAdditiveAndExclusiveDiscounts(admin, items, additive, exclusive)
}

export interface BundleNudge {
  title: string
  /** How many more eligible items the cart needs to unlock the deal. */
  itemsNeeded: number
  type: Discount['type']
  value: number
}

/**
 * The active bundle deal closest to being unlocked, for the cart's "add N
 * more items" hint — null when there's no bundle deal running, or every
 * one already applies. With a code attached, only bundles that let codes
 * stack count (any other bundle is replaced by the code, so promising it
 * would be wrong — see resolveDiscountForCart).
 */
export async function resolveBundleNudge(
  admin: Admin,
  items: CartItemWithVariant[],
  hasCodeAttached: boolean,
): Promise<BundleNudge | null> {
  if (items.length === 0) return null
  const bundles = (await getActiveAutomaticDiscounts(admin)).filter(
    (d): d is typeof d & { min_quantity: number } =>
      d.min_quantity != null &&
      d.type !== 'free_gift' &&
      (!hasCodeAttached || d.stacks_with_sale),
  )
  if (bundles.length === 0) return null

  let best: BundleNudge | null = null
  for (const bundle of bundles) {
    const eligible = await eligibleItemsForDiscount(admin, bundle, items)
    const itemsNeeded = bundle.min_quantity - eligibleUnitCount(eligible)
    if (itemsNeeded <= 0) continue
    if (!best || itemsNeeded < best.itemsNeeded) {
      best = {
        title: bundle.title,
        itemsNeeded,
        type: bundle.type,
        value: bundle.value,
      }
    }
  }
  return best
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

/** Non-throwing form of assertDiscountIsRedeemable — inactive, not started
 *  yet, expired, or out of uses all return false. */
export function isDiscountRedeemable(discount: Discount): boolean {
  try {
    assertDiscountIsRedeemable(discount)
    return true
  } catch {
    return false
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
  await assertCreatorCodeEligible(admin, discount.id)

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

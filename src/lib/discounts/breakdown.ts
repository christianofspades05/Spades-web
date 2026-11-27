import type { AppliedCartDiscount } from '#/server/cart/discount'

/** One row of a discount breakdown — the cart/checkout summary and the
 *  copy saved on the order (orders.discount_breakdown) for admin. */
export interface DiscountBreakdownPart {
  kind: 'code' | 'bundle' | 'sale'
  title: string
  code: string | null
  type: AppliedCartDiscount['type']
  value: number
  minQuantity: number | null
  /** Affiliate (creator) code — its rate differs per line, so no single
   *  rate is shown for it. */
  affiliate: boolean
  amountCents: number
}

/**
 * Splits an applied (possibly stacked) discount into one part per
 * discount — sales and bundle deals first, the customer's code last —
 * scaled so the parts add up exactly to `totalCents` (the amount actually
 * charged, e.g. after checkout's market markup).
 */
export function buildDiscountBreakdown(
  discount: AppliedCartDiscount | null | undefined,
  totalCents: number,
): DiscountBreakdownPart[] {
  if (!discount || totalCents <= 0) return []
  const stacked = discount.stackedWith.filter((s) => s.amountCents > 0)
  const stackedCents = stacked.reduce((sum, s) => sum + s.amountCents, 0)
  const kindOf = (minQuantity: number | null | undefined) =>
    minQuantity ? ('bundle' as const) : ('sale' as const)

  const primary: DiscountBreakdownPart = {
    kind: discount.code ? 'code' : kindOf(discount.minQuantity),
    title: discount.title,
    code: discount.code,
    type: discount.type,
    value: discount.value,
    minQuantity: discount.minQuantity ?? null,
    affiliate: Boolean(discount.affiliate),
    amountCents: Math.max(0, discount.amountCents - stackedCents),
  }
  const others: DiscountBreakdownPart[] = stacked.map((s) => ({
    kind: kindOf(s.minQuantity),
    title: s.title,
    code: null,
    type: s.type,
    value: s.value,
    minQuantity: s.minQuantity ?? null,
    affiliate: false,
    amountCents: s.amountCents,
  }))
  const parts = (
    discount.code ? [...others, primary] : [primary, ...others]
  ).filter((part) => part.amountCents > 0)
  if (parts.length === 0) return []

  const rawTotal = parts.reduce((sum, part) => sum + part.amountCents, 0)
  let remaining = totalCents
  return parts.map((part, index) => {
    const cents =
      index === parts.length - 1
        ? remaining
        : Math.round((part.amountCents * totalCents) / rawTotal)
    remaining -= cents
    return { ...part, amountCents: cents }
  })
}

/** Plain-English label for a part (admin order details). */
export function discountBreakdownLabel(
  part: DiscountBreakdownPart,
  formatPrice: (cents: number) => string,
): string {
  const rate =
    part.type === 'fixed_amount'
      ? `${formatPrice(part.value)} off`
      : `${part.value}% off`
  if (part.kind === 'code') {
    const name = `Code ${part.code ?? part.title}`
    return part.affiliate ? `${name} (affiliate)` : `${name} (${rate})`
  }
  if (part.kind === 'bundle') {
    return `Bundle deal: extra ${rate} (${part.minQuantity}+ items)`
  }
  return part.type === 'free_shipping' ? part.title : `${part.title} (${rate})`
}

/**
 * The shipping line shown in the cart's order summary, before the shopper
 * has reached checkout. Uses the same shippingCostCents rules checkout and
 * place-order.ts charge with, so the cart never promises less than checkout
 * will ask for:
 *   - PH, already over the free-shipping threshold → free
 *   - PH, region already chosen earlier in checkout → that exact fee
 *   - PH, no region yet → the lowest domestic rate, shown as "From ₱60"
 *   - anywhere else → calculated at checkout (market rates, currency
 *     conversion and markups all depend on the chosen country)
 */
import {
  FREE_SHIPPING_THRESHOLD_CENTS,
  SHIPPING_ZONE_RATE_CENTS,
  shippingCostCents,
} from '#/lib/checkout/shipping'

export type CartShippingEstimate =
  | { kind: 'free' }
  | { kind: 'exact'; cents: number }
  | { kind: 'from'; cents: number }
  | { kind: 'at_checkout' }

export const LOWEST_PH_SHIPPING_CENTS = Math.min(
  ...Object.values(SHIPPING_ZONE_RATE_CENTS),
)

export function estimateCartShipping({
  country,
  region,
  province,
  subtotalAfterDiscountCents,
  itemCount,
  excludeFreeShipping,
}: {
  country: string
  region: string
  province: string
  subtotalAfterDiscountCents: number
  itemCount: number
  excludeFreeShipping: boolean
}): CartShippingEstimate {
  if (country !== 'PH') return { kind: 'at_checkout' }
  if (
    !excludeFreeShipping &&
    subtotalAfterDiscountCents >= FREE_SHIPPING_THRESHOLD_CENTS
  ) {
    return { kind: 'free' }
  }
  if (region) {
    const cents = shippingCostCents(
      'PH',
      region,
      province,
      subtotalAfterDiscountCents,
      itemCount,
      {},
      undefined,
      excludeFreeShipping,
    )
    return cents === 0 ? { kind: 'free' } : { kind: 'exact', cents }
  }
  return { kind: 'from', cents: LOWEST_PH_SHIPPING_CENTS }
}

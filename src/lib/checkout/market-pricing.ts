/**
 * Single source of truth for the per-country product-price markup math —
 * called both where the customer sees the total (checkout pages) and where
 * it's actually charged (place-order.ts), so the two can never disagree.
 * Deliberately separate from shipping cost (see shipping.ts) — the markup
 * never touches the shipping fee, only the product subtotal.
 */
import type { MarketMarkups } from '#/server/storefront/market-pricing'

/** `markupPercent` is e.g. 15 for +15% — undefined/0 (no markup configured
 *  for this country, or the country is PH) returns `cents` unchanged. */
export function applyMarketMarkup(
  cents: number,
  markupPercent: number | undefined,
): number {
  if (!markupPercent) return cents
  return Math.round(cents * (1 + markupPercent / 100))
}

/** Looks up the country's markup from the fetched table — PH is never
 *  marked up regardless of what's configured. */
export function markupPercentForCountry(
  country: string,
  markups: MarketMarkups,
): number | undefined {
  if (country === 'PH') return undefined
  return markups[country]
}

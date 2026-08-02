/**
 * Flat-rate shipping by macro-region. Free shipping over FREE_SHIPPING_THRESHOLD_CENTS
 * matches the site-wide banner ("Free shipping minimum of ₱2,000 purchase") —
 * that promo is PH-domestic only and does not apply to international orders.
 */
import { convertCentsToPhp } from '#/lib/utils/money'
import type { ExchangeRates } from '#/lib/utils/money'
import type { MarketShippingConfig } from '#/server/storefront/market-pricing'

export const FREE_SHIPPING_THRESHOLD_CENTS = 200_000

/** Flat international shipping fee, in US dollars. */
export const INTERNATIONAL_SHIPPING_USD = 10

// Used only in the brief window before a live USD/PHP rate has loaded from
// the exchange_rates table (see lib/currency/CurrencyContext.tsx) — an
// approximate PHP-per-USD rate so the checkout page never shows $0 or NaN
// shipping while rates are still fetching. place-order.ts always re-derives
// the real charge from the live rate server-side, so this never affects
// what a customer is actually charged — only a possible instant of display
// imprecision before the real rate arrives.
const FALLBACK_PHP_PER_USD = 58

/** International shipping cost in PHP cents — `usdToPhpRate` is
 *  exchange_rates.rate_to_php for 'USD' (units of USD per 1 PHP), or null
 *  if it hasn't loaded yet. */
export function internationalShippingCostCents(
  usdToPhpRate: number | null,
): number {
  const phpPerUsd = usdToPhpRate ? 1 / usdToPhpRate : FALLBACK_PHP_PER_USD
  return Math.round(INTERNATIONAL_SHIPPING_USD * phpPerUsd * 100)
}

export const SHIPPING_ZONES = [
  'metro_manila',
  'luzon',
  'visayas',
  'mindanao',
] as const
export type ShippingZone = (typeof SHIPPING_ZONES)[number]

export const SHIPPING_ZONE_RATE_CENTS: Record<ShippingZone, number> = {
  metro_manila: 10_000,
  luzon: 14_000,
  visayas: 16_000,
  mindanao: 18_000,
}

const LUZON_REGIONS = new Set([
  'REGION I (ILOCOS REGION)',
  'REGION II (CAGAYAN VALLEY)',
  'REGION III (CENTRAL LUZON)',
  'REGION IV-A (CALABARZON)',
  'MIMAROPA REGION',
  'REGION V (BICOL REGION)',
  'CORDILLERA ADMINISTRATIVE REGION (CAR)',
])

const VISAYAS_REGIONS = new Set([
  'REGION VI (WESTERN VISAYAS)',
  'REGION VII (CENTRAL VISAYAS)',
  'REGION VIII (EASTERN VISAYAS)',
])

const MINDANAO_REGIONS = new Set([
  'REGION IX (ZAMBOANGA PENINSULA)',
  'REGION X (NORTHERN MINDANAO)',
  'REGION XI (DAVAO REGION)',
  'REGION XII (SOCCSKSARGEN)',
  'REGION XIII (Caraga)',
  'BANGSAMORO AUTONOMOUS REGION (BARMM)',
])

export function shippingZoneForRegion(region: string): ShippingZone {
  if (region === 'NATIONAL CAPITAL REGION (NCR)') return 'metro_manila'
  if (LUZON_REGIONS.has(region)) return 'luzon'
  if (VISAYAS_REGIONS.has(region)) return 'visayas'
  if (MINDANAO_REGIONS.has(region)) return 'mindanao'
  // Unknown region string (shouldn't happen given the dropdown is sourced
  // from the same dataset) — fall back to the highest rate rather than
  // under-charging shipping.
  return 'mindanao'
}

/** Single entry point for shipping cost, dispatching by destination
 *  country. PH orders use the existing region-based zone rates (with the
 *  free-shipping threshold). Every other country uses its market's own
 *  shipping override (see admin/markets) when one is set — entered in
 *  whatever currency that market's shipping is denominated in (e.g. SGD),
 *  converted to PHP cents here via `rates` (exchange_rates.rate_to_php for
 *  every currency — pass {} if not loaded yet). A market-level
 *  free-shipping trigger (min subtotal or min item count) waives it
 *  entirely — falling back to the flat INTERNATIONAL_SHIPPING_USD when no
 *  market override applies. */
export function shippingCostCents(
  country: string,
  region: string,
  subtotalCents: number,
  itemCount: number,
  rates: ExchangeRates,
  marketShipping?: MarketShippingConfig,
): number {
  if (country !== 'PH') {
    if (
      marketShipping?.freeShippingMinSubtotalCents != null &&
      subtotalCents >= marketShipping.freeShippingMinSubtotalCents
    ) {
      return 0
    }
    if (
      marketShipping?.freeShippingMinItems != null &&
      itemCount >= marketShipping.freeShippingMinItems
    ) {
      return 0
    }
    if (marketShipping?.shippingPriceCents != null) {
      return convertCentsToPhp(
        marketShipping.shippingPriceCents,
        marketShipping.shippingCurrency,
        rates,
      )
    }
    return internationalShippingCostCents(rates.USD ?? null)
  }
  if (subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS) return 0
  const zone = shippingZoneForRegion(region)
  return SHIPPING_ZONE_RATE_CENTS[zone]
}

export interface FreeShippingProgress {
  type: 'amount' | 'items'
  /** Cents (if type is 'amount', always PHP) or a plain item count (if
   *  type is 'items') still needed to reach free shipping. Always > 0 —
   *  null is returned instead once the threshold is already met. */
  remaining: number
}

/** How far a cart still is from free shipping — used for the "add X more
 *  to unlock free shipping" nudge (cart popup, cart page, checkout form).
 *  Returns null once free shipping already applies, or when the
 *  destination has no free-shipping mechanism at all (an international
 *  country with no active market, or one whose market never set a
 *  free-shipping trigger). PH always uses the site-wide domestic
 *  threshold; every other country uses its own market's trigger, if any. */
export function freeShippingProgress(
  country: string,
  subtotalCents: number,
  itemCount: number,
  marketShipping?: MarketShippingConfig,
): FreeShippingProgress | null {
  if (country === 'PH') {
    const remaining = FREE_SHIPPING_THRESHOLD_CENTS - subtotalCents
    return remaining > 0 ? { type: 'amount', remaining } : null
  }
  if (marketShipping?.freeShippingMinSubtotalCents != null) {
    const remaining =
      marketShipping.freeShippingMinSubtotalCents - subtotalCents
    return remaining > 0 ? { type: 'amount', remaining } : null
  }
  if (marketShipping?.freeShippingMinItems != null) {
    const remaining = marketShipping.freeShippingMinItems - itemCount
    return remaining > 0 ? { type: 'items', remaining } : null
  }
  return null
}

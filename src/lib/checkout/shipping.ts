/**
 * Flat-rate shipping by macro-region. Free shipping over FREE_SHIPPING_THRESHOLD_CENTS
 * matches the site-wide banner ("Free shipping minimum of ₱2,000 purchase").
 */

export const FREE_SHIPPING_THRESHOLD_CENTS = 200_000

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

export function shippingCostCents(
  region: string,
  subtotalCents: number,
): number {
  if (subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS) return 0
  const zone = shippingZoneForRegion(region)
  return SHIPPING_ZONE_RATE_CENTS[zone]
}

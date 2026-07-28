/**
 * All money is stored and computed in integer cents (centavos) to avoid
 * floating-point rounding errors. Only format to a display string at the
 * UI edge.
 */

export function pesosToCents(pesos: number): number {
  return Math.round(pesos * 100)
}

export function centsToPesos(cents: number): number {
  return cents / 100
}

export function formatCentsAsPHP(cents: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(centsToPesos(cents))
}

/** currency (ISO 4217) -> units of that currency per 1 PHP. Populated from
 *  the exchange_rates table (see server/currency/rates.ts) — never includes
 *  a 'PHP' key since converting PHP to PHP is always a no-op. */
export type ExchangeRates = Record<string, number>

// Matches exactly what Xendit's card multi-currency processing supports for
// PH merchants (see lib/xendit/client.ts) — the display selector never
// needs to change if/when charging currencies expand.
export const SUPPORTED_CURRENCIES = [
  'PHP',
  'USD',
  'EUR',
  'SGD',
  'HKD',
  'MYR',
  'THB',
  'VND',
] as const
export type Currency = (typeof SUPPORTED_CURRENCIES)[number]

const CURRENCY_LOCALE: Record<string, string> = {
  PHP: 'en-PH',
  USD: 'en-US',
  EUR: 'de-DE',
  SGD: 'en-SG',
  HKD: 'en-HK',
  MYR: 'ms-MY',
  THB: 'th-TH',
  VND: 'vi-VN',
}

// Most of our supported currencies use 2 decimal places (100 minor units
// per major unit) — VND is the exception: Vietnamese Dong has no
// subdivision in everyday use, and Intl.NumberFormat formats it with 0
// fraction digits by default (confirmed: formatting 423233.955 as VND
// prints "423,234 ₫", not "4,232.34 ₫"). "Cents" below always means
// "minor units," which is 1 for VND, not 100.
const MINOR_UNITS_PER_MAJOR: Record<string, number> = {
  PHP: 100,
  USD: 100,
  EUR: 100,
  SGD: 100,
  HKD: 100,
  MYR: 100,
  THB: 100,
  VND: 1,
}

function minorUnitsPerMajor(currency: string): number {
  return MINOR_UNITS_PER_MAJOR[currency] ?? 100
}

/** Currency-parameterized version of formatCentsAsPHP — the amount is
 *  assumed to already be in the target currency's own minor units (i.e.
 *  already converted, see convertCents), not PHP cents. */
export function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat(CURRENCY_LOCALE[currency] ?? 'en-US', {
    style: 'currency',
    currency,
  }).format(cents / minorUnitsPerMajor(currency))
}

/** `currency` if it can actually be converted to right now (it's PHP, which
 *  never needs a rate, or a rate for it is already loaded) — otherwise
 *  'PHP', so a caller never ends up formatting/labeling an unconverted PHP
 *  amount with a foreign currency's symbol while rates are still loading. */
export function effectiveCurrency(
  currency: string,
  rates: ExchangeRates,
): string {
  return currency === 'PHP' || rates[currency] != null ? currency : 'PHP'
}

/** Converts an amount in PHP cents to the equivalent amount in `currency`'s
 *  own minor units, using the given PHP-per-1-unit exchange rates. Returns
 *  the input unchanged for 'PHP' or when no rate is loaded yet (e.g. rates
 *  still fetching on first render) — never throws, since a missing rate
 *  just means "show PHP for a moment," not a broken page. */
export function convertCents(
  phpCents: number,
  currency: string,
  rates: ExchangeRates,
): number {
  if (currency === 'PHP') return phpCents
  const rate = rates[currency]
  if (!rate) return phpCents
  const phpMajor = phpCents / 100
  const targetMajor = phpMajor * rate
  return Math.round(targetMajor * minorUnitsPerMajor(currency))
}

/** `cents` (in `currency`'s own minor units, e.g. already converted via
 *  convertCents) -> a plain major-unit number, for ad-platform pixel events
 *  (Meta's `value` param wants a bare number, not a formatted string). */
export function centsToMajorUnits(cents: number, currency: string): number {
  return cents / minorUnitsPerMajor(currency)
}

/** Inverse of centsToMajorUnits — a plain major-unit number (e.g. from a
 *  payment provider's webhook payload) -> `currency`'s own minor units. */
export function majorUnitsToCents(amount: number, currency: string): number {
  return Math.round(amount * minorUnitsPerMajor(currency))
}

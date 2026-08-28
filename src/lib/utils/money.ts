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

// Originally matched exactly what Xendit's card multi-currency processing
// supports for PH merchants (see lib/xendit/client.ts) — JPY/MOP were added
// on top for display purposes (Japan/Macau markets) even though Xendit
// support for them isn't confirmed yet; harmless since every card charge
// still settles in PHP regardless of display currency until that's resolved.
export const SUPPORTED_CURRENCIES = [
  'PHP',
  'USD',
  'EUR',
  'SGD',
  'HKD',
  'MYR',
  'THB',
  'VND',
  'JPY',
  'MOP',
  'KRW',
  'TWD',
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
  JPY: 'ja-JP',
  MOP: 'zh-MO',
  KRW: 'ko-KR',
  TWD: 'zh-TW',
}

// Most of our supported currencies use 2 decimal places (100 minor units
// per major unit) — VND, JPY, KRW, and TWD are exceptions: none has a
// subdivision in everyday use, even though TWD's ISO 4217 exponent is
// officially 2 (Intl.NumberFormat defaults to "$810.00", not "$810" —
// confirmed live — so formatCents below overrides fraction digits
// explicitly for this group rather than relying on Intl's own default).
// "Cents" below always means "minor units," which is 1 for these four,
// not 100.
const MINOR_UNITS_PER_MAJOR: Record<string, number> = {
  PHP: 100,
  USD: 100,
  EUR: 100,
  SGD: 100,
  HKD: 100,
  MYR: 100,
  THB: 100,
  VND: 1,
  JPY: 1,
  MOP: 100,
  KRW: 1,
  TWD: 1,
}

export function minorUnitsPerMajor(currency: string): number {
  return MINOR_UNITS_PER_MAJOR[currency] ?? 100
}

/** Currency-parameterized version of formatCentsAsPHP — the amount is
 *  assumed to already be in the target currency's own minor units (i.e.
 *  already converted, see convertCents), not PHP cents. */
export function formatCents(cents: number, currency: string): string {
  const zeroDecimal = minorUnitsPerMajor(currency) === 1
  return new Intl.NumberFormat(CURRENCY_LOCALE[currency] ?? 'en-US', {
    style: 'currency',
    currency,
    ...(zeroDecimal
      ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
      : {}),
  }).format(cents / minorUnitsPerMajor(currency))
}

/** Coarsens a PHP -> foreign-currency conversion to a "clean" round number
 *  instead of an arbitrary decimal (e.g. a live rate producing 4376 JPY or
 *  32.56 SGD) — nearest 10 major units for currencies with no minor unit in
 *  everyday use (4376 -> 4380, confirmed live: JPY was still landing on an
 *  arbitrary ones digit after only rounding to the nearest 1), nearest
 *  one-tenth of a major unit otherwise (32.56 -> 32.6). Requested so every
 *  market's displayed/charged price looks deliberately set, not like raw
 *  exchange-rate math. Only applied going PHP -> foreign (convertCents) —
 *  reverse conversions of an already-charged real amount (convertCentsToPhp,
 *  majorUnitsToCents) parse actual money and must stay exact. */
function roundToCleanDisplayAmount(
  majorAmount: number,
  currency: string,
): number {
  if (minorUnitsPerMajor(currency) === 1) {
    return Math.round(majorAmount / 10) * 10
  }
  return Math.round(majorAmount * 10) / 10
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
  const cleaned = roundToCleanDisplayAmount(targetMajor, currency)
  return Math.round(cleaned * minorUnitsPerMajor(currency))
}

/** Inverse of convertCents — an amount already in `currency`'s own minor
 *  units (e.g. a market's shipping_price_cents, denominated in
 *  shipping_currency) -> the equivalent PHP cents, using the same PHP-
 *  per-1-unit rate table. Returns the input unchanged for 'PHP' or when no
 *  rate is loaded yet, same never-throws contract as convertCents. */
export function convertCentsToPhp(
  amountCents: number,
  currency: string,
  rates: ExchangeRates,
): number {
  if (currency === 'PHP') return amountCents
  const rate = rates[currency]
  if (!rate) return amountCents
  const currencyMajor = amountCents / minorUnitsPerMajor(currency)
  const phpMajor = currencyMajor / rate
  return Math.round(phpMajor * 100)
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

/** Order/reservation rows are always PHP-denominated internally regardless
 *  of what the customer was actually charged (see
 *  server/checkout/place-order.ts) — only PayPal orders carry a real
 *  charged-currency amount (payments.charged_currency/charged_amount_cents),
 *  known only as a single final total, never a per-line breakdown. Every
 *  caller that needs to show a customer-facing breakdown (order-
 *  confirmation/new-order emails, the checkout confirmation page) scales
 *  each PHP component by the same ratio so subtotal + shipping - discount
 *  still reconciles to the shown total, while the total line itself uses
 *  the exact captured amount rather than a scaled-and-rounded approximation
 *  of it. Returns a no-op converter (PHP unchanged) when nothing was
 *  charged in a different currency, e.g. Xendit/COD orders. */
export function chargedCurrencyConversion(
  totalPhpCents: number,
  chargedCurrency: string | null | undefined,
  chargedAmountCents: number | null | undefined,
): { currency: string; convert: (phpCents: number) => number; totalCents: number } {
  if (!chargedCurrency || chargedAmountCents == null) {
    return { currency: 'PHP', convert: (phpCents) => phpCents, totalCents: totalPhpCents }
  }
  const ratio = totalPhpCents > 0 ? chargedAmountCents / totalPhpCents : 1
  return {
    currency: chargedCurrency,
    convert: (phpCents) => Math.round(phpCents * ratio),
    totalCents: chargedAmountCents,
  }
}

/**
 * Philippine mobile number normalisation, shared by checkout, the account
 * address book, and anything downstream that reads a stored phone (order
 * shipping_address, Lalamove bookings, waybills staff copy by hand).
 *
 * Accepts every common way a shopper types a PH mobile number —
 * 09171234567, 9171234567, +639171234567, 639171234567, +63 0917…, and any
 * of those with spaces, dashes, dots or brackets — and returns the one
 * stored format, 09XXXXXXXXX. That's the format ~99% of existing storefront
 * orders already use, so new orders stay consistent with them.
 *
 * Returns null when it isn't a PH mobile number (wrong length, or not a 9xx
 * mobile prefix after the country/trunk code is removed).
 */
export function normalizePhMobile(raw: string): string | null {
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('63') && digits.length >= 12) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = digits.slice(1)
  return /^9\d{9}$/.test(digits) ? `0${digits}` : null
}

export const PH_MOBILE_ERROR_MESSAGE =
  'Enter a valid PH mobile number, e.g. 0917 123 4567'

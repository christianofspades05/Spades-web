/**
 * Remembers a guest's contact + delivery details on this device after a
 * successful order, so their next checkout starts filled in. localStorage
 * (not the checkout's own sessionStorage) so it survives closing the tab.
 * Never stores payment details or order notes. The checkout shows a
 * "Not you?" link whenever it prefills from here, which wipes it — the
 * escape hatch for a shared phone.
 */
import type { CheckoutInfo } from '#/lib/checkout/CheckoutContext'

const STORAGE_KEY = 'spades_returning_customer'
/** Forget details after a year without an order on this device. */
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000

export const REMEMBERED_FIELDS = [
  'email',
  'recipientName',
  'phone',
  'country',
  'region',
  'province',
  'city',
  'barangay',
  'postalCode',
  'addressLine1',
  'addressLine2',
  'landmark',
] as const satisfies readonly (keyof CheckoutInfo)[]

export type RememberedCheckoutDetails = Pick<
  CheckoutInfo,
  (typeof REMEMBERED_FIELDS)[number]
>

export function saveReturningCustomer(info: CheckoutInfo): void {
  try {
    const details = Object.fromEntries(
      REMEMBERED_FIELDS.map((field) => [field, info[field]]),
    ) as RememberedCheckoutDetails
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ savedAt: Date.now(), details }),
    )
  } catch {
    // Private mode / storage full — remembering is a convenience only.
  }
}

export function loadReturningCustomer(): RememberedCheckoutDetails | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      savedAt?: number
      details?: Partial<RememberedCheckoutDetails>
    }
    if (!parsed.savedAt || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(STORAGE_KEY)
      return null
    }
    const details = parsed.details ?? {}
    if (!details.email || !details.addressLine1) return null
    return Object.fromEntries(
      REMEMBERED_FIELDS.map((field) => [
        field,
        typeof details[field] === 'string' ? details[field] : '',
      ]),
    ) as RememberedCheckoutDetails
  } catch {
    return null
  }
}

export function forgetReturningCustomer(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

/** True when the checkout form has nothing typed into it yet — the only
 *  time a prefill is applied, so it never overwrites what the shopper (or
 *  this session's own saved progress) already has. */
export function isCheckoutInfoBlank(info: CheckoutInfo): boolean {
  return !info.email && !info.phone && !info.recipientName && !info.addressLine1
}

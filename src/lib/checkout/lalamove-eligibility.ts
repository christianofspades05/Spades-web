/**
 * Whether the Lalamove same-day-courier checkout option should be offered:
 * Spades only, Metro Manila only, any day except Sunday. Checked both
 * client-side (to show/hide the option) and server-side in place-order.ts
 * (never trust the client).
 *
 * Orders can be PLACED any time (except Sunday), but actual riders are only
 * booked 10AM-4PM daily — see LALAMOVE_BOOKING_START_HOUR/END_HOUR below,
 * used for the customer-facing copy explaining when their order will
 * actually get booked, not for gating whether the option is selectable.
 */
import { shippingZoneForRegion } from '#/lib/checkout/shipping'
import { storeLocalDayOfWeek } from '#/lib/utils/date-range'

const SUNDAY = 0

/** The daily window staff actually book Lalamove riders in — informational
 *  only (see module doc comment above), shown in the checkout copy so
 *  customers know when to expect their order booked. */
export const LALAMOVE_BOOKING_START_HOUR = 10
export const LALAMOVE_BOOKING_END_HOUR = 16

export function isLalamoveAvailableToday(now: Date = new Date()): boolean {
  return storeLocalDayOfWeek(now) !== SUNDAY
}

/** Brand/region check only, no day-of-week — lets the checkout UI show the
 *  Lalamove option (disabled, with a "not available on Sundays" note) on a
 *  Sunday instead of hiding it outright, so a Metro Manila customer
 *  browsing on a Sunday still knows the option exists. */
export function isLalamoveRegionEligible(input: {
  brand: string
  region: string
}): boolean {
  return (
    input.brand === 'spades' &&
    shippingZoneForRegion(input.region) === 'metro_manila'
  )
}

export function isLalamoveEligible(input: {
  brand: string
  region: string
  now?: Date
}): boolean {
  return (
    isLalamoveRegionEligible(input) && isLalamoveAvailableToday(input.now)
  )
}

// Charged to the customer on top of the live quote (see place-order.ts) —
// the trip gets re-quoted when staff actually book it later, which can run
// higher during rush hour, so this buffer is the store's cushion against
// that drift rather than something collected from the customer again.
export const LALAMOVE_FEE_BUFFER_CENTS = 5000

/**
 * "Is this creator worth the money?" — the status badge and alert rules for
 * Analytics → Affiliates. Pure functions so they're unit-tested and shared
 * by the page, the CSV export and the alerts list.
 */

/** Every threshold the status rules use, in one place. */
export const AFFILIATE_STATUS_RULES = {
  /** Scale: ROI at or above this (2 = profit is 2× what we spent)… */
  scaleMinRoi: 2,
  /** …and at least this many orders in the selected range. */
  scaleMinOrders: 5,
  /** Test: a gift/fee given fewer than this many days ago. */
  testGiftWithinDays: 30,
  /** Test: fewer than this many orders in the range. */
  testMaxOrders: 5,
  /** Stop: this many days since the last gift/fee with 0 orders since. */
  stopDaysSinceGift: 30,
  /** Stop: ROI below 0 over this trailing window. */
  stopRoiWindowDays: 60,
  /** Alert: commission ready to pay at or above this (centavos). */
  payoutAlertMinCents: 1,
} as const

export type AffiliateStatus = 'scale' | 'test' | 'stop' | 'no_code' | 'idle'

export const AFFILIATE_STATUS_LABELS: Record<AffiliateStatus, string> = {
  scale: 'Scale',
  test: 'Test',
  stop: 'Stop',
  no_code: 'No code',
  idle: 'Not started',
}

export interface AffiliateStatusInput {
  hasActiveCode: boolean
  lifetimeExpensesCents: number
  orders: number
  roi: number | null
  lastGiftAt: string | null
  ordersSinceLastGift: number
  profit60dCents: number
  spent60dCents: number
}

export function daysSince(
  iso: string | null,
  now: Date = new Date(),
): number | null {
  if (!iso) return null
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000)
}

/**
 * Priority, top wins:
 * 1. No code — we've spent on them but they have no active code to track.
 * 2. Scale  — ROI ≥ 2× and ≥ 5 orders in range.
 * 3. Test   — gift/fee under 30 days ago (still waiting on results).
 * 4. Stop   — ≥ 30 days since last gift/fee and 0 orders since, or ROI < 0
 *             over the last 60 days.
 * 5. Test   — anything else that has spend or orders (fewer than 5 orders,
 *             or ROI under 2×).
 * 6. Not started — no spend, no orders yet.
 */
export function affiliateStatus(
  input: AffiliateStatusInput,
  now: Date = new Date(),
): AffiliateStatus {
  const r = AFFILIATE_STATUS_RULES
  if (input.lifetimeExpensesCents > 0 && !input.hasActiveCode) return 'no_code'
  if (
    input.roi !== null &&
    input.roi >= r.scaleMinRoi &&
    input.orders >= r.scaleMinOrders
  )
    return 'scale'
  const giftDays = daysSince(input.lastGiftAt, now)
  if (giftDays !== null && giftDays < r.testGiftWithinDays) return 'test'
  if (
    giftDays !== null &&
    giftDays >= r.stopDaysSinceGift &&
    input.ordersSinceLastGift === 0
  )
    return 'stop'
  if (input.spent60dCents > 0 && input.profit60dCents < 0) return 'stop'
  if (input.lifetimeExpensesCents === 0 && input.orders === 0) return 'idle'
  return 'test'
}

export function roiOf(profitCents: number, spentCents: number): number | null {
  return spentCents > 0 ? profitCents / spentCents : null
}

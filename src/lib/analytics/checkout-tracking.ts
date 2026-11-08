/**
 * Step-level checkout funnel tracking — checkout_view through
 * checkout_order_success (see lib/validation/analytics.ts's EVENT_TYPES).
 * Posts to api/track/checkout.ts, which does the exact same
 * storefront_visits insert recordVisit does (see that route's doc
 * comment for why a plain endpoint instead of the createServerFn
 * products/$slug.tsx already uses for checkout_start).
 *
 * Every call here is fire-and-forget: wrapped in try/catch, never
 * awaited by the caller, and sent via navigator.sendBeacon where
 * available (falling back to fetch with keepalive) so it still survives a
 * page that's about to redirect or unload — e.g. checkout_place_order_
 * clicked firing a moment before the place-order request goes out, or
 * checkout_payment_redirect firing right before window.location.href
 * sends the browser to Xendit/PayPal. None of this can ever throw back
 * into checkout's own code path or block it.
 */
import { getOrCreateVisitorId } from '#/lib/analytics/visitor-id'
import type { EventType } from '#/lib/validation/analytics'

const SESSION_KEY = 'spades_checkout_funnel_tracked'

function readTrackedKeys(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function markTracked(key: string): void {
  try {
    const keys = readTrackedKeys()
    keys.add(key)
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify([...keys]))
  } catch {
    // Best-effort only — a dedupe miss just means one possible duplicate
    // event, never a reason to block checkout.
  }
}

export interface TrackCheckoutEventInput {
  cartId: string
  eventType: EventType
  /** Merged into the event's metadata under `cart_id` automatically —
   *  pass everything else the funnel needs here (no PII: see each event's
   *  metadata shape in lib/validation/analytics.ts's doc comment). */
  metadata?: Record<string, unknown>
  brand: string
  /** Extra dedupe key beyond (cartId, eventType) — e.g. the payment
   *  method, so switching from COD to online still fires again instead of
   *  being swallowed by the "once per cart" rule below. */
  dedupeKey?: string
  /** Skips the per-cart/session dedupe entirely — for the two events that
   *  may legitimately fire more than once in the same checkout
   *  (checkout_validation_error, checkout_order_error). Every other event
   *  fires at most once per (cartId, eventType) per browser session. */
  allowRepeat?: boolean
}

/** Best-effort, short error identifier for checkout_order_error's
 *  `error_code` — a Postgrest error (thrown as a plain {message, code,
 *  details, hint} object, not a real Error — see lib/utils/errors.ts's
 *  own doc comment) carries a real Postgres error code; a plain `throw new
 *  Error(...)` elsewhere in the checkout path doesn't, so this falls back
 *  to a generic marker rather than guessing. */
export function errorCodeOf(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    if (typeof err.code === 'string') return err.code
  }
  return 'unknown'
}

export function trackCheckoutEvent({
  cartId,
  eventType,
  metadata,
  brand,
  dedupeKey,
  allowRepeat,
}: TrackCheckoutEventInput): void {
  try {
    if (!cartId) return

    const dedupeTag = dedupeKey ? `:${dedupeKey}` : ''
    const key = `${cartId}:${eventType}${dedupeTag}`
    if (!allowRepeat) {
      const tracked = readTrackedKeys()
      if (tracked.has(key)) return
      markTracked(key)
    }

    const body = JSON.stringify({
      visitorId: getOrCreateVisitorId(),
      path: '/checkout',
      eventType,
      metadata: { cart_id: cartId, ...metadata },
      brand,
    })

    if ('sendBeacon' in navigator) {
      navigator.sendBeacon(
        '/api/track/checkout',
        new Blob([body], { type: 'application/json' }),
      )
      return
    }
    void fetch('/api/track/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Tracking must never break or slow down checkout.
  }
}

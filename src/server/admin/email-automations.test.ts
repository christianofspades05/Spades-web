// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { computeAttributionStats } from './email-automations'

const day = (n: number) => new Date(`2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`).getTime()

describe('computeAttributionStats', () => {
  it('credits a repeat-abandoner\'s eventual order once per automation, not once per matching send', () => {
    const order = {
      id: 'order-1',
      shipping_address: { email: 'buyer@example.com' },
      placed_at: new Date(day(12)).toISOString(),
      total_cents: 10_000,
    }

    const { statsByAutomationId, statsInRangeByAutomationId, sendStatsByAutomationId } =
      computeAttributionStats(
        [order],
        [
          // Same automation, sent twice before the customer finally buys —
          // the real-world case that used to double-count this one order.
          {
            email_automation_id: 'auto-cart-8h',
            recipient_email: 'buyer@example.com',
            sent_at: new Date(day(1)).toISOString(),
          },
          {
            email_automation_id: 'auto-cart-8h',
            recipient_email: 'buyer@example.com',
            sent_at: new Date(day(10)).toISOString(),
          },
          // A different automation to the same recipient before the same
          // order — this SHOULD still count independently for this row.
          {
            email_automation_id: 'auto-welcome',
            recipient_email: 'buyer@example.com',
            sent_at: new Date(day(5)).toISOString(),
          },
        ],
        day(10), // picker range: day 10–20
        day(20),
      )

    const cart8h = statsByAutomationId.get('auto-cart-8h')
    const cart8hInRange = statsInRangeByAutomationId.get('auto-cart-8h')
    const cart8hSends = sendStatsByAutomationId.get('auto-cart-8h')
    const welcome = statsByAutomationId.get('auto-welcome')

    // All-time: one order, one automation row → counted once, not twice.
    expect(cart8h).toEqual({ count: 1, revenueCents: 10_000 })
    // Both raw sends still show up in the send count — dedup only applies
    // to attribution, never to how many emails were actually sent.
    expect(cart8hSends?.total).toBe(2)

    // The order was already claimed by the day(1) send, which falls
    // OUTSIDE the picker's range (day 10–20) — so it must not reappear in
    // the in-range bucket just because a later, in-range send also
    // technically matched it.
    expect(cart8hInRange).toBeUndefined()
    expect(cart8hSends?.inRange).toBe(1)

    // A different automation attributing the same order is untouched by
    // the other automation's dedup bookkeeping.
    expect(welcome).toEqual({ count: 1, revenueCents: 10_000 })
  })

  it('still counts distinct customers/orders separately within the same automation', () => {
    const orders = [
      {
        id: 'order-a',
        shipping_address: { email: 'a@example.com' },
        placed_at: new Date(day(2)).toISOString(),
        total_cents: 5_000,
      },
      {
        id: 'order-b',
        shipping_address: { email: 'b@example.com' },
        placed_at: new Date(day(3)).toISOString(),
        total_cents: 7_000,
      },
    ]
    const sends = [
      {
        email_automation_id: 'auto-cart-8h',
        recipient_email: 'a@example.com',
        sent_at: new Date(day(1)).toISOString(),
      },
      {
        email_automation_id: 'auto-cart-8h',
        recipient_email: 'b@example.com',
        sent_at: new Date(day(1)).toISOString(),
      },
    ]

    const { statsByAutomationId } = computeAttributionStats(
      orders,
      sends,
      day(1),
      day(1),
    )

    expect(statsByAutomationId.get('auto-cart-8h')).toEqual({
      count: 2,
      revenueCents: 12_000,
    })
  })
})

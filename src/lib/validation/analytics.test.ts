import { describe, expect, it } from 'vitest'
import { recordVisitSchema } from './analytics'

describe('cart funnel events', () => {
  it.each(['cart_view', 'cart_checkout_clicked'])(
    'accepts %s at the tracking endpoint',
    (eventType) => {
      const result = recordVisitSchema.safeParse({
        visitorId: '00000000-0000-4000-8000-000000000000',
        path: '/cart',
        eventType,
        metadata: { item_count: 2, subtotal_cents: 178_600 },
      })
      expect(result.success).toBe(true)
    },
  )
})

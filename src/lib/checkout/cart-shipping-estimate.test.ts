import { describe, expect, it } from 'vitest'
import {
  LOWEST_PH_SHIPPING_CENTS,
  estimateCartShipping,
} from './cart-shipping-estimate'
import { recordVisitSchema } from '#/lib/validation/analytics'

const base = {
  country: 'PH',
  region: '',
  province: '',
  subtotalAfterDiscountCents: 89_300,
  itemCount: 1,
  excludeFreeShipping: false,
}

describe('estimateCartShipping', () => {
  it('shows "from ₱60" for PH before a region is known', () => {
    expect(LOWEST_PH_SHIPPING_CENTS).toBe(6_000)
    expect(estimateCartShipping(base)).toEqual({ kind: 'from', cents: 6_000 })
  })

  it('uses the exact zone fee once a region was entered at checkout', () => {
    expect(
      estimateCartShipping({
        ...base,
        region: 'REGION VII (CENTRAL VISAYAS)',
        province: 'Cebu',
      }),
    ).toEqual({ kind: 'exact', cents: 7_500 })
    expect(
      estimateCartShipping({
        ...base,
        region: 'REGION XI (DAVAO REGION)',
        province: 'Davao del Sur',
      }),
    ).toEqual({ kind: 'exact', cents: 8_000 })
  })

  it('is free at or over the ₱2,000 threshold', () => {
    expect(
      estimateCartShipping({ ...base, subtotalAfterDiscountCents: 200_000 }),
    ).toEqual({ kind: 'free' })
  })

  it('still charges over the threshold when the code excludes free shipping', () => {
    expect(
      estimateCartShipping({
        ...base,
        subtotalAfterDiscountCents: 250_000,
        excludeFreeShipping: true,
      }),
    ).toEqual({ kind: 'from', cents: 6_000 })
  })

  it('leaves international shipping to checkout', () => {
    expect(estimateCartShipping({ ...base, country: 'US' })).toEqual({
      kind: 'at_checkout',
    })
  })
})

describe('new cart funnel events', () => {
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

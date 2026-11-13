import { describe, expect, it } from 'vitest'
import { isDiscountRedeemable } from './discount'
import type { Discount } from '#/types/entities'

const HOUR = 60 * 60 * 1000

function discount(overrides: Partial<Discount>): Discount {
  return {
    is_active: true,
    starts_at: null,
    ends_at: null,
    max_uses: null,
    times_used: 0,
    ...overrides,
  } as Discount
}

describe('isDiscountRedeemable', () => {
  it('accepts an active code inside its window', () => {
    expect(
      isDiscountRedeemable(
        discount({
          starts_at: new Date(Date.now() - HOUR).toISOString(),
          ends_at: new Date(Date.now() + HOUR).toISOString(),
        }),
      ),
    ).toBe(true)
  })

  it('rejects an expired code (e.g. a 24h welcome code applied yesterday)', () => {
    expect(
      isDiscountRedeemable(
        discount({ ends_at: new Date(Date.now() - HOUR).toISOString() }),
      ),
    ).toBe(false)
  })

  it('rejects a code that has not started yet', () => {
    expect(
      isDiscountRedeemable(
        discount({ starts_at: new Date(Date.now() + HOUR).toISOString() }),
      ),
    ).toBe(false)
  })

  it('rejects a deactivated or used-up code', () => {
    expect(isDiscountRedeemable(discount({ is_active: false }))).toBe(false)
    expect(
      isDiscountRedeemable(discount({ max_uses: 10, times_used: 10 })),
    ).toBe(false)
  })
})

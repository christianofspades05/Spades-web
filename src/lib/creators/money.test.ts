import { describe, expect, it } from 'vitest'
import { allocateCents, chargedItemAmounts } from './money'

describe('charged product allocation', () => {
  it('preserves the John example in centavos', () => {
    const [line] = chargedItemAmounts(200000, 20000, [{ subtotal: 200000, discount: 20000 }])
    expect(Math.round((line.chargedProductCents - line.chargedDiscountCents) * 800 / 10000)).toBe(14400)
  })
  it('allocates every cent once, including uneven international markup', () => {
    expect(allocateCents(100, [1, 1, 1])).toEqual([34, 33, 33])
    const lines = chargedItemAmounts(33001, 3301, [{ subtotal: 10000, discount: 1000 }, { subtotal: 20000, discount: 2000 }])
    expect(lines.reduce((sum, line) => sum + line.chargedProductCents - line.chargedDiscountCents, 0)).toBe(29700)
  })
  it('keeps discounts on the actual eligible items', () => {
    expect(chargedItemAmounts(30000, 5000, [{ subtotal: 10000, discount: 5000 }, { subtotal: 20000, discount: 0 }]))
      .toEqual([{ chargedProductCents: 10000, chargedDiscountCents: 5000 }, { chargedProductCents: 20000, chargedDiscountCents: 0 }])
  })
  it('rejects invalid money and impossible allocation', () => {
    expect(() => allocateCents(1, [0])).toThrow()
    expect(() => allocateCents(1.5, [1])).toThrow()
    expect(() => chargedItemAmounts(10, 11, [{ subtotal: 10, discount: 11 }])).toThrow()
  })
})

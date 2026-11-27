import { describe, expect, it } from 'vitest'
import { buildDiscountBreakdown, discountBreakdownLabel } from './breakdown'
import type { AppliedCartDiscount } from '#/server/cart/discount'

const sale = (amountCents: number): AppliedCartDiscount => ({
  id: 'sale',
  code: null,
  title: 'BLACK FRIDAY',
  type: 'percentage',
  value: 15,
  amountCents,
  excludesFreeShipping: false,
  minQuantity: null,
  stackedWith: [],
  itemBreakdown: [],
})

describe('buildDiscountBreakdown', () => {
  it('splits a sale and a bundle deal and keeps the total exact', () => {
    const parts = buildDiscountBreakdown(
      {
        ...sale(70218),
        stackedWith: [
          {
            title: 'BUNDLE',
            amountCents: 25398,
            type: 'percentage',
            value: 10,
            minQuantity: 3,
          },
        ],
      },
      70218,
    )
    expect(parts.map((p) => [p.kind, p.amountCents])).toEqual([
      ['sale', 44820],
      ['bundle', 25398],
    ])
    expect(discountBreakdownLabel(parts[1], (c) => `₱${c / 100}`)).toBe(
      'Bundle deal: extra 10% off (3+ items)',
    )
  })

  it('scales parts to a marked-up charged total', () => {
    const parts = buildDiscountBreakdown(
      {
        ...sale(300),
        stackedWith: [
          { title: 'B', amountCents: 100, type: 'percentage', value: 10 },
        ],
      },
      331,
    )
    expect(parts.reduce((s, p) => s + p.amountCents, 0)).toBe(331)
  })

  it('puts a code last', () => {
    const parts = buildDiscountBreakdown(
      {
        ...sale(1500),
        id: 'code',
        code: 'WELCOME10',
        title: 'Welcome',
        value: 10,
        stackedWith: [
          {
            title: 'BLACK FRIDAY',
            amountCents: 1000,
            type: 'percentage',
            value: 15,
          },
        ],
      },
      1500,
    )
    expect(parts.map((p) => p.kind)).toEqual(['sale', 'code'])
    expect(discountBreakdownLabel(parts[1], String)).toBe(
      'Code WELCOME10 (10% off)',
    )
  })
})

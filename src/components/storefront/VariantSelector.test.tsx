// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { VariantSelector } from './VariantSelector'
import type { VariantWithStock } from './VariantSelector'

vi.mock('#/lib/i18n/LanguageContext', () => ({
  useLanguage: () => ({
    t: { product: { size: 'Size', color: 'Color', style: 'Style' } },
  }),
}))

afterEach(cleanup)

function variant(
  id: string,
  size: string,
  stock: number,
  overrides: Partial<VariantWithStock> = {},
): VariantWithStock {
  return {
    id,
    product_id: 'p1',
    sku: id,
    size,
    color: null,
    style: null,
    price_cents: 89300,
    compare_at_price_cents: null,
    is_active: true,
    is_pre_order: false,
    pre_order_available: 0,
    inventory: [{ quantity_available: stock }],
    ...overrides,
  } as VariantWithStock
}

describe('VariantSelector sold-out sizes', () => {
  it('disables a sold-out size and labels it "Sold out"', () => {
    render(
      <VariantSelector
        variants={[variant('m', 'M', 3), variant('l', 'L', 0)]}
        onVariantChange={() => {}}
      />,
    )
    const soldOut = screen.getByRole('button', { name: 'L, sold out' })
    expect(soldOut).toHaveProperty('disabled', true)
    expect(soldOut.textContent).toContain('Sold out')

    const inStock = screen.getByRole('button', { name: 'M' })
    expect(inStock).toHaveProperty('disabled', false)
    expect(inStock.textContent).not.toContain('Sold out')
  })

  it('keeps a pre-order size with pre-order stock selectable', () => {
    render(
      <VariantSelector
        variants={[
          variant('m', 'M', 0, { is_pre_order: true, pre_order_available: 5 }),
          variant('l', 'L', 1),
        ]}
        onVariantChange={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'M' })).toHaveProperty(
      'disabled',
      false,
    )
  })
})

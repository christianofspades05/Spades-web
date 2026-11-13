// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CartStockWarning } from './CartStockWarning'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="#">{children}</a>
  ),
}))

afterEach(cleanup)

const base = {
  cartItemId: 'ci1',
  productName: 'Spades Savage Instinct Boxy Crop Tee',
  productSlug: 'savage-instinct',
  variantLabel: 'L',
  requestedQuantity: 1,
}

describe('CartStockWarning', () => {
  it('renders nothing when every line is available', () => {
    const { container } = render(<CartStockWarning issues={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('names the sold-out size and tells the shopper what to do', () => {
    render(<CartStockWarning issues={[{ ...base, availableQuantity: 0 }]} />)
    expect(screen.getByRole('alert').textContent).toContain(
      'Size L of Spades Savage Instinct Boxy Crop Tee just sold out.',
    )
    expect(screen.getByRole('alert').textContent).toContain(
      'Pick another size or remove it from your cart.',
    )
  })

  it('asks to lower the quantity when only some are left', () => {
    render(
      <CartStockWarning
        issues={[{ ...base, requestedQuantity: 3, availableQuantity: 2 }]}
      />,
    )
    expect(screen.getByRole('alert').textContent).toContain(
      'Only 2 left of Spades Savage Instinct Boxy Crop Tee (L).',
    )
  })
})

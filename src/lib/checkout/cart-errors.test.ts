import { describe, expect, it } from 'vitest'
import { CART_ERROR_MESSAGES, cartErrorReasonOf } from './cart-errors'

describe('cartErrorReasonOf', () => {
  it('maps every cart error message back to its reason', () => {
    for (const [reason, message] of Object.entries(CART_ERROR_MESSAGES)) {
      expect(cartErrorReasonOf(message)).toBe(reason)
    }
  })

  it('keeps every reason message distinct', () => {
    const messages = Object.values(CART_ERROR_MESSAGES)
    expect(new Set(messages).size).toBe(messages.length)
  })

  it('returns null for unrelated errors', () => {
    expect(
      cartErrorReasonOf('"Spades Mantra Tee" no longer has enough stock'),
    ).toBeNull()
  })
})

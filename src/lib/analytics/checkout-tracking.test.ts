// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { errorCodeOf, trackCheckoutEvent } from './checkout-tracking'

describe('errorCodeOf', () => {
  it('reads a Postgrest-style error code', () => {
    expect(errorCodeOf({ message: 'duplicate', code: '23505' })).toBe('23505')
  })

  it('falls back for a plain Error with no code', () => {
    expect(errorCodeOf(new Error('Missing exchange rate'))).toBe('unknown')
  })

  it('falls back for a non-object value', () => {
    expect(errorCodeOf('oops')).toBe('unknown')
    expect(errorCodeOf(null)).toBe('unknown')
  })
})

describe('trackCheckoutEvent', () => {
  const sendBeacon = vi.fn((_url: string, _data: Blob) => true)

  beforeEach(() => {
    window.sessionStorage.clear()
    sendBeacon.mockClear()
    Object.defineProperty(window.navigator, 'sendBeacon', {
      value: sendBeacon,
      configurable: true,
    })
  })

  it('sends a beacon with cart_id folded into metadata', () => {
    trackCheckoutEvent({
      cartId: 'cart-1',
      eventType: 'checkout_view',
      brand: 'spades',
      metadata: { item_count: 2 },
    })
    expect(sendBeacon).toHaveBeenCalledTimes(1)
    const [url, blob] = sendBeacon.mock.calls[0]
    expect(url).toBe('/api/track/checkout')
    expect(blob).toBeInstanceOf(Blob)
  })

  it('fires each event at most once per (cartId, eventType)', () => {
    trackCheckoutEvent({
      cartId: 'cart-1',
      eventType: 'checkout_view',
      brand: 'spades',
    })
    trackCheckoutEvent({
      cartId: 'cart-1',
      eventType: 'checkout_view',
      brand: 'spades',
    })
    expect(sendBeacon).toHaveBeenCalledTimes(1)
  })

  it('does not dedupe across different carts', () => {
    trackCheckoutEvent({
      cartId: 'cart-1',
      eventType: 'checkout_view',
      brand: 'spades',
    })
    trackCheckoutEvent({
      cartId: 'cart-2',
      eventType: 'checkout_view',
      brand: 'spades',
    })
    expect(sendBeacon).toHaveBeenCalledTimes(2)
  })

  it('fires again when dedupeKey changes (payment method switch)', () => {
    trackCheckoutEvent({
      cartId: 'cart-1',
      eventType: 'checkout_payment_selected',
      brand: 'spades',
      dedupeKey: 'cod',
    })
    trackCheckoutEvent({
      cartId: 'cart-1',
      eventType: 'checkout_payment_selected',
      brand: 'spades',
      dedupeKey: 'cod',
    })
    trackCheckoutEvent({
      cartId: 'cart-1',
      eventType: 'checkout_payment_selected',
      brand: 'spades',
      dedupeKey: 'online',
    })
    expect(sendBeacon).toHaveBeenCalledTimes(2)
  })

  it('allowRepeat bypasses the dedupe entirely', () => {
    trackCheckoutEvent({
      cartId: 'cart-1',
      eventType: 'checkout_order_error',
      brand: 'spades',
      allowRepeat: true,
    })
    trackCheckoutEvent({
      cartId: 'cart-1',
      eventType: 'checkout_order_error',
      brand: 'spades',
      allowRepeat: true,
    })
    expect(sendBeacon).toHaveBeenCalledTimes(2)
  })

  it('does nothing without a cartId', () => {
    trackCheckoutEvent({
      cartId: '',
      eventType: 'checkout_view',
      brand: 'spades',
    })
    expect(sendBeacon).not.toHaveBeenCalled()
  })

  it('never throws even if sendBeacon itself throws', () => {
    sendBeacon.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(() =>
      trackCheckoutEvent({
        cartId: 'cart-1',
        eventType: 'checkout_view',
        brand: 'spades',
      }),
    ).not.toThrow()
  })
})

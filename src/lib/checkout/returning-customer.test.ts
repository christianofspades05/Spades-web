// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  forgetReturningCustomer,
  isCheckoutInfoBlank,
  loadReturningCustomer,
  saveReturningCustomer,
} from './returning-customer'
import { EMPTY_CHECKOUT_INFO } from './CheckoutContext'

vi.mock('#/server/checkout/prefill', () => ({
  getCheckoutPrefill: vi.fn(),
}))

const filled = {
  ...EMPTY_CHECKOUT_INFO,
  email: 'juan@example.com',
  recipientName: 'Juan Dela Cruz',
  phone: '09171234567',
  region: 'NATIONAL CAPITAL REGION (NCR)',
  province: 'Metro Manila',
  city: 'Quezon City',
  barangay: 'Bagumbayan',
  addressLine1: '1 Sample St',
  orderNotes: 'Leave with the guard',
}

afterEach(() => {
  window.localStorage.clear()
  vi.useRealTimers()
})

describe('returning customer memory', () => {
  it('round-trips contact and address details', () => {
    saveReturningCustomer(filled)
    const loaded = loadReturningCustomer()
    expect(loaded?.email).toBe('juan@example.com')
    expect(loaded?.barangay).toBe('Bagumbayan')
    expect(loaded?.phone).toBe('09171234567')
  })

  it('never stores order notes', () => {
    saveReturningCustomer(filled)
    expect(
      window.localStorage.getItem('spades_returning_customer'),
    ).not.toContain('guard')
  })

  it('"Not you?" forgets everything', () => {
    saveReturningCustomer(filled)
    forgetReturningCustomer()
    expect(loadReturningCustomer()).toBeNull()
  })

  it('expires after a year', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01'))
    saveReturningCustomer(filled)
    vi.setSystemTime(new Date('2027-01-02'))
    expect(loadReturningCustomer()).toBeNull()
  })

  it('ignores corrupt or incomplete data', () => {
    window.localStorage.setItem('spades_returning_customer', '{not json')
    expect(loadReturningCustomer()).toBeNull()
    window.localStorage.setItem(
      'spades_returning_customer',
      JSON.stringify({ savedAt: Date.now(), details: { email: 'a@b.co' } }),
    )
    expect(loadReturningCustomer()).toBeNull()
  })

  it('only prefills a blank form', () => {
    expect(isCheckoutInfoBlank(EMPTY_CHECKOUT_INFO)).toBe(true)
    expect(isCheckoutInfoBlank({ ...EMPTY_CHECKOUT_INFO, phone: '0917' })).toBe(
      false,
    )
  })
})

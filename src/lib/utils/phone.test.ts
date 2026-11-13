import { describe, expect, it } from 'vitest'
import { normalizePhMobile } from './phone'
import { checkoutContactSchema } from '#/lib/validation/checkout'
import { philippineAddressSchema } from '#/lib/validation/address'

describe('normalizePhMobile', () => {
  it.each([
    '09171234567',
    '9171234567',
    '+639171234567',
    '639171234567',
    '0917 123 4567',
    '0917-123-4567',
    '(0917) 123 4567',
    '+63 917 123 4567',
    '+63 (917) 123-4567',
    '+63 0917 123 4567',
    ' 0917.123.4567 ',
  ])('accepts %s', (input) => {
    expect(normalizePhMobile(input)).toBe('09171234567')
  })

  it.each([
    '',
    '0917123456', // one digit short
    '091712345678', // one digit long
    '08171234567', // not a 9xx mobile prefix
    '0281234567', // Metro Manila landline
    '+1 415 555 0100',
    'abc',
  ])('rejects %s', (input) => {
    expect(normalizePhMobile(input)).toBeNull()
  })
})

const baseContact = {
  email: 'shopper@example.com',
  recipientName: 'Juan Dela Cruz',
  country: 'PH',
  region: 'NATIONAL CAPITAL REGION (NCR)',
  province: 'Metro Manila',
  city: 'Quezon City',
  barangay: 'Bagumbayan',
  postalCode: '1110',
  addressLine1: '1 Sample St',
}

describe('checkoutContactSchema phone', () => {
  it('stores a formatted PH number as 09XXXXXXXXX', () => {
    const result = checkoutContactSchema.safeParse({
      ...baseContact,
      phone: '(0917) 123-4567',
    })
    expect(result.success).toBe(true)
    expect(result.data?.phone).toBe('09171234567')
  })

  it('rejects an invalid PH number on the phone field only', () => {
    const result = checkoutContactSchema.safeParse({
      ...baseContact,
      phone: '0917 123',
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((i) => i.path[0])).toEqual(['phone'])
  })

  it('leaves non-PH numbers as typed', () => {
    const result = checkoutContactSchema.safeParse({
      ...baseContact,
      country: 'US',
      region: undefined,
      barangay: undefined,
      phone: '+1 (415) 555-0100',
    })
    expect(result.success).toBe(true)
    expect(result.data?.phone).toBe('+1 (415) 555-0100')
  })
})

describe('philippineAddressSchema phone', () => {
  it('normalises the address-book phone the same way', () => {
    const result = philippineAddressSchema.safeParse({
      recipientName: 'Juan Dela Cruz',
      phone: '+63 917 123 4567',
      region: 'NATIONAL CAPITAL REGION (NCR)',
      province: 'Metro Manila',
      city: 'Quezon City',
      barangay: 'Bagumbayan',
      addressLine1: '1 Sample St',
    })
    expect(result.success).toBe(true)
    expect(result.data?.phone).toBe('09171234567')
  })
})

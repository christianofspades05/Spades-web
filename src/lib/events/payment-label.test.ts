import { describe, expect, it } from 'vitest'
import { registrationPaymentLabel } from './payment-label'

const base = {
  fee_cents: 5_000,
  fee_waiver: null,
  status: 'confirmed' as const,
  xendit_invoice_id: 'inv_123',
}

describe('registrationPaymentLabel', () => {
  it('confirmed with a Xendit invoice is paid online', () => {
    expect(registrationPaymentLabel(base)).toEqual({
      label: 'Paid online',
      tone: 'success',
    })
  })

  it('confirmed with a fee but no invoice was added by staff (e.g. Pabol)', () => {
    expect(
      registrationPaymentLabel({ ...base, xendit_invoice_id: null }).label,
    ).toBe('Added by staff')
  })

  it('pending is awaiting payment and released is not paid', () => {
    expect(registrationPaymentLabel({ ...base, status: 'pending' }).label).toBe(
      'Awaiting payment',
    )
    expect(
      registrationPaymentLabel({ ...base, status: 'released' }).label,
    ).toBe('Not paid')
  })

  it('labels free registrations and why they were free', () => {
    expect(
      registrationPaymentLabel({
        ...base,
        fee_cents: 0,
        xendit_invoice_id: null,
      }).label,
    ).toBe('Free')
    expect(
      registrationPaymentLabel({
        ...base,
        fee_cents: 0,
        fee_waiver: 'affiliate',
        xendit_invoice_id: null,
      }).label,
    ).toBe('Free · Affiliate')
    expect(
      registrationPaymentLabel({
        ...base,
        fee_cents: 0,
        fee_waiver: 'staff',
        xendit_invoice_id: null,
      }).label,
    ).toBe('Free · Admin')
  })
})

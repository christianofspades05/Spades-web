import type { EventRegistrationRow } from '#/types/community-events'

export type PaymentLabelTone = 'success' | 'info' | 'warning' | 'neutral'

/**
 * Whether a registrant has actually paid, for the admin registrant list.
 * `status` alone can't say: an "Add registrant" entry is confirmed with the
 * event's fee but no Xendit invoice (settled offline — cash at the door or
 * comped), while an online registration is only confirmed once Xendit
 * reports the invoice paid.
 */
export function registrationPaymentLabel(
  reg: Pick<
    EventRegistrationRow,
    'fee_cents' | 'fee_waiver' | 'status' | 'xendit_invoice_id'
  >,
): { label: string; tone: PaymentLabelTone } {
  if (reg.fee_waiver === 'affiliate') {
    return { label: 'Free · Affiliate', tone: 'neutral' }
  }
  if (reg.fee_waiver === 'staff') {
    return { label: 'Free · Admin', tone: 'neutral' }
  }
  if (reg.fee_cents === 0) return { label: 'Free', tone: 'neutral' }
  if (reg.status === 'confirmed') {
    return reg.xendit_invoice_id
      ? { label: 'Paid online', tone: 'success' }
      : { label: 'Added by staff', tone: 'warning' }
  }
  if (reg.status === 'pending') {
    return { label: 'Awaiting payment', tone: 'info' }
  }
  return { label: 'Not paid', tone: 'neutral' }
}

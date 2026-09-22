/**
 * Best-effort ops alert for "a customer's payment provider confirmed the
 * charge, but we couldn't turn it into an order" — e.g. mint_checkout_order
 * failed because the reserved stock sold out from under it in the interim.
 * After 0093's soft-delete fix these should be rare (the previous silent
 * failure mode — a late PAID event finding no reservation at all — is what
 * this whole mechanism exists to catch going forward), but money has
 * already changed hands here, so this must never depend on someone noticing
 * a `webhook_events.status = 'failed'` row by accident again.
 */
export async function alertPaymentMintFailure(details: {
  provider: string
  externalId: string
  error: unknown
}): Promise<void> {
  const storeOwnerEmail = process.env.STORE_OWNER_EMAIL
  if (!storeOwnerEmail) return
  try {
    const { sendEmail, withDisplayName } = await import('#/lib/email/resend')
    const message =
      details.error instanceof Error
        ? details.error.message
        : String(details.error)
    await sendEmail({
      to: storeOwnerEmail,
      subject: `Payment confirmed but order not created (${details.provider})`,
      from: withDisplayName(
        'Spades Official Orders',
        process.env.RESEND_FROM_EMAIL_ORDERS,
      ),
      html: `
        <p>A ${details.provider} payment was confirmed but no order could be created from it. This needs manual follow-up — the customer was charged.</p>
        <ul>
          <li><strong>Reference:</strong> ${details.externalId}</li>
          <li><strong>Error:</strong> ${message}</li>
        </ul>
        <p>Check the <code>webhook_events</code> table (source = payment_provider) for the full payload, and <code>checkout_reservations</code> for this id — it's kept, not deleted, specifically so this can still be recovered manually.</p>
      `,
    })
  } catch (err) {
    console.error('Failed to send payment-mint-failure alert:', err)
  }
}

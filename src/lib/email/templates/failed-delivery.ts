function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function failedDeliveryEmailSubject(orderNumber: string): string {
  return `We couldn't deliver order ${orderNumber}`
}

export interface FailedDeliveryEmailInput {
  orderNumber: string
  customerFirstName: string | null
  /** /reorder/$orderId on the order's own brand domain — see cancelOrder's
   *  trigger in server/admin/orders.ts. */
  reorderUrl: string
}

/**
 * Sent automatically the moment staff cancel a storefront order with reason
 * 'failed_delivery' (see cancelOrder). Two deliberate wording choices:
 *
 * - The common failure reasons are listed neutrally (wrong number, no one
 *   home, rejected, courier never attempted it) — this never names or
 *   accuses the courier of anything in writing, even though the reason this
 *   email asks "did you actually receive it?" at all is a known courier-side
 *   fraud pattern (a rider collects COD, marks the parcel returned, and
 *   swaps the returned box for junk) — that's for staff to know internally,
 *   not something to put in a customer-facing accusation with legal
 *   exposure for us.
 * - The reorder link pushes online payment over COD ("assure delivery")
 *   without saying COD is why the previous one failed, since plenty of
 *   failed deliveries have nothing to do with payment method at all.
 */
export function failedDeliveryEmailHtml(
  input: FailedDeliveryEmailInput,
): string {
  const greeting = input.customerFirstName
    ? `Hi ${escapeHtml(input.customerFirstName)},`
    : 'Hi,'

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 20px; color: #171717;">
      <p style="font-size: 13px; color: #737373; text-transform: uppercase; letter-spacing: 0.04em;">
        Order ${escapeHtml(input.orderNumber)}
      </p>
      <p style="font-size: 15px; line-height: 1.6; color: #404040;">${greeting}</p>
      <p style="font-size: 15px; line-height: 1.6; color: #404040;">
        Unfortunately, our courier was unable to deliver this order. This can happen for a few reasons:
      </p>
      <ul style="font-size: 15px; line-height: 1.8; color: #404040; padding-left: 20px; margin: 0 0 16px;">
        <li>The contact number on file couldn't be reached</li>
        <li>No one was available to receive it</li>
        <li>The delivery was declined</li>
        <li>The courier was unable to attempt delivery</li>
      </ul>
      <p style="font-size: 15px; line-height: 1.6; color: #404040; font-weight: 600;">
        If you did receive this order, please reply to this email and let us know — it genuinely helps us a lot.
      </p>
      <p style="font-size: 15px; line-height: 1.6; color: #404040;">
        If you'd like to try again, we'd suggest paying online at checkout instead of Cash on Delivery — it's the most reliable way to make sure a re-attempted delivery actually goes through.
      </p>
      <p style="text-align: center; margin: 28px 0;">
        <a href="${escapeHtml(input.reorderUrl)}" style="display: inline-block; background: #171717; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 6px;">
          Order Again
        </a>
      </p>
      <p style="font-size: 13px; line-height: 1.6; color: #737373;">
        Your items are already added — just review and check out.
      </p>
      <p style="font-size: 13px; line-height: 1.6; color: #a3a3a3; margin-top: 24px;">
        Reply directly to this email and we'll get back to you.
      </p>
    </div>
  `
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface ShipmentTrackingEmailInput {
  orderNumber: string
  carrier: string | null
  trackingNumber: string
  trackingUrl: string | null
}

export function shipmentTrackingEmailSubject(orderNumber: string): string {
  return `Your order ${orderNumber} has shipped`
}

export function shipmentTrackingEmailHtml(
  input: ShipmentTrackingEmailInput,
): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 20px; color: #171717;">
      <p style="font-size: 16px;">Your order is on its way!</p>
      <p style="font-size: 15px; line-height: 1.6; color: #404040;">
        Order <strong>${escapeHtml(input.orderNumber)}</strong> has shipped${input.carrier ? ` via ${escapeHtml(input.carrier)}` : ''}.
      </p>
      <p style="font-size: 15px; line-height: 1.6; color: #171717; background: #f5f5f5; border-radius: 8px; padding: 12px 16px; margin: 16px 0;">
        Tracking number<br />
        <strong style="font-size: 16px;">${escapeHtml(input.trackingNumber)}</strong>
      </p>
      ${
        input.trackingUrl
          ? `<a href="${escapeHtml(input.trackingUrl)}" style="display: inline-block; background: #0a0a0a; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 999px; margin-top: 8px;">
        Track shipment
      </a>`
          : ''
      }
    </div>
  `
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface PickupPhotoEmailInput {
  orderNumber: string
  photoUrl: string
  trackingUrl: string | null
}

export function pickupPhotoEmailSubject(orderNumber: string): string {
  return `Your order ${orderNumber} has been picked up`
}

export function pickupPhotoEmailHtml(input: PickupPhotoEmailInput): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 20px; color: #171717;">
      <p style="font-size: 16px;">Your rider has picked up your order!</p>
      <p style="font-size: 15px; line-height: 1.6; color: #404040;">
        Here's a photo of order <strong>${escapeHtml(input.orderNumber)}</strong> at pickup, on its way to you now.
      </p>
      <img
        src="${escapeHtml(input.photoUrl)}"
        alt="Order ${escapeHtml(input.orderNumber)} at pickup"
        style="display: block; width: 100%; border-radius: 8px; margin: 16px 0;"
      />
      ${
        input.trackingUrl
          ? `<a href="${escapeHtml(input.trackingUrl)}" style="display: inline-block; background: #0a0a0a; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 999px; margin-top: 8px;">
        Track delivery
      </a>`
          : ''
      }
    </div>
  `
}

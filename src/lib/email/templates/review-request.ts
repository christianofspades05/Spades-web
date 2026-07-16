function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export const REVIEW_REQUEST_EMAIL_SUBJECT = 'How was your order? Leave a review'

export interface ReviewRequestEmailInput {
  customerName: string | null
  orderNumber: string
  reviewUrl: string
  items: { name: string; image: string | null }[]
}

export function reviewRequestEmailHtml(input: ReviewRequestEmailInput): string {
  const greeting = input.customerName
    ? `Hi ${escapeHtml(input.customerName.split(' ')[0])},`
    : 'Hi,'

  const itemsHtml = input.items
    .map(
      (item) => `
        <tr>
          <td style="padding: 8px 0;">
            ${
              item.image
                ? `<img src="${escapeHtml(item.image)}" alt="" width="56" height="56" style="border-radius: 8px; object-fit: cover; vertical-align: middle;" />`
                : ''
            }
            <span style="margin-left: 12px; font-size: 14px; color: #171717; vertical-align: middle;">${escapeHtml(item.name)}</span>
          </td>
        </tr>
      `,
    )
    .join('')

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 20px; color: #171717;">
      <p style="font-size: 16px;">${greeting}</p>
      <p style="font-size: 15px; line-height: 1.6; color: #404040;">
        Thanks for your order <strong>${escapeHtml(input.orderNumber)}</strong> from Spades! We'd love to know what you thought — it only takes a minute.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        ${itemsHtml}
      </table>
      <a href="${escapeHtml(input.reviewUrl)}" style="display: inline-block; background: #0a0a0a; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 999px; margin-top: 8px;">
        Rate &amp; review your order
      </a>
      <p style="font-size: 12px; color: #a3a3a3; margin-top: 32px;">
        This link is unique to your order and can only be used once.
      </p>
    </div>
  `
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export const ABANDONED_CART_EMAIL_SUBJECT = 'You left something in your cart'

export interface AbandonedCartEmailInput {
  items: {
    name: string
    variantLabel: string | null
    image: string | null
    quantity: number
    lineTotalCents: number
  }[]
  subtotalCents: number
  resumeUrl: string
  unsubscribeUrl: string
}

export function abandonedCartEmailHtml(input: AbandonedCartEmailInput): string {
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
            <span style="margin-left: 12px; font-size: 14px; color: #171717; vertical-align: middle;">
              ${escapeHtml(item.name)}${item.variantLabel ? ` <span style="color: #a3a3a3;">(${escapeHtml(item.variantLabel)})</span>` : ''} × ${item.quantity}
            </span>
          </td>
          <td style="padding: 8px 0; font-size: 14px; color: #404040; text-align: right;">
            ${(item.lineTotalCents / 100).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}
          </td>
        </tr>
      `,
    )
    .join('')

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 20px; color: #171717;">
      <p style="font-size: 16px;">Still thinking it over?</p>
      <p style="font-size: 15px; line-height: 1.6; color: #404040;">
        You left some items in your cart at Spades. They're still here whenever you're ready.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        ${itemsHtml}
      </table>
      <p style="font-size: 15px; font-weight: 600; text-align: right; margin: 0 0 20px;">
        Subtotal: ${(input.subtotalCents / 100).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}
      </p>
      <a href="${escapeHtml(input.resumeUrl)}" style="display: inline-block; background: #0a0a0a; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 999px;">
        Back to your cart
      </a>
      <p style="font-size: 12px; color: #a3a3a3; margin-top: 32px;">
        <a href="${escapeHtml(input.unsubscribeUrl)}" style="color: #a3a3a3;">Unsubscribe</a> from cart reminder emails.
      </p>
    </div>
  `
}

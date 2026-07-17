function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export const NEW_ORDER_EMAIL_SUBJECT_PREFIX = 'New order'

export interface NewOrderEmailInput {
  orderNumber: string
  customerName: string | null
  customerEmail: string
  totalCents: number
  isCod: boolean
  items: { name: string; variantLabel: string | null; quantity: number }[]
  orderUrl: string
}

export function newOrderEmailSubject(orderNumber: string): string {
  return `${NEW_ORDER_EMAIL_SUBJECT_PREFIX} — ${orderNumber}`
}

export function newOrderEmailHtml(input: NewOrderEmailInput): string {
  const itemsHtml = input.items
    .map(
      (item) => `
        <tr>
          <td style="padding: 6px 0; font-size: 14px; color: #171717;">
            ${escapeHtml(item.name)}${item.variantLabel ? ` <span style="color: #a3a3a3;">(${escapeHtml(item.variantLabel)})</span>` : ''}
          </td>
          <td style="padding: 6px 0; font-size: 14px; color: #404040; text-align: right;">
            ×${item.quantity}
          </td>
        </tr>
      `,
    )
    .join('')

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 20px; color: #171717;">
      <p style="font-size: 16px;">You've got a new order.</p>
      <p style="font-size: 15px; line-height: 1.6; color: #404040;">
        <strong>${escapeHtml(input.orderNumber)}</strong> from ${escapeHtml(input.customerName ?? input.customerEmail)}
        — ${(input.totalCents / 100).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}
        (${input.isCod ? 'Cash on Delivery' : 'Paid online'})
      </p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        ${itemsHtml}
      </table>
      <a href="${escapeHtml(input.orderUrl)}" style="display: inline-block; background: #0a0a0a; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 999px; margin-top: 8px;">
        View order
      </a>
    </div>
  `
}

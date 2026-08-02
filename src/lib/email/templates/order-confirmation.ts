function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface OrderConfirmationEmailInput {
  orderNumber: string
  items: { name: string; variantLabel: string | null; quantity: number }[]
  totalCents: number
  accountUrl: string
}

export function orderConfirmationEmailSubject(orderNumber: string): string {
  return `Order confirmed — ${orderNumber}`
}

export function orderConfirmationEmailHtml(
  input: OrderConfirmationEmailInput,
): string {
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
      <p style="font-size: 16px;">Thanks for your order!</p>
      <p style="font-size: 15px; line-height: 1.6; color: #404040;">
        Order <strong>${escapeHtml(input.orderNumber)}</strong> is confirmed —
        we'll email you again once it ships.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        ${itemsHtml}
      </table>
      <p style="font-size: 15px; font-weight: 600; color: #171717; text-align: right; border-top: 1px solid #e5e5e5; padding-top: 12px;">
        Total: ${(input.totalCents / 100).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })}
      </p>
      <a href="${escapeHtml(input.accountUrl)}" style="display: inline-block; background: #0a0a0a; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 999px; margin-top: 8px;">
        View order
      </a>
    </div>
  `
}

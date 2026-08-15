function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatPHP(cents: number): string {
  return (cents / 100).toLocaleString('en-PH', {
    style: 'currency',
    currency: 'PHP',
  })
}

export interface OrderConfirmationEmailItem {
  name: string
  variantLabel: string | null
  quantity: number
  imageUrl: string | null
  lineTotalCents: number
}

export interface OrderConfirmationEmailInput {
  orderNumber: string
  items: OrderConfirmationEmailItem[]
  subtotalCents: number
  shippingCents: number
  /** 0 when no discount applied — the breakdown row is left out entirely rather than shown as ₱0.00. */
  discountCents: number
  totalCents: number
  /** Public, no-login tracking page for this specific order — see
   *  server/storefront/order-tracking.ts. */
  trackingUrl: string
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
          <td style="padding: 8px 0; width: 48px; vertical-align: top;">
            ${
              item.imageUrl
                ? `<img src="${escapeHtml(item.imageUrl)}" alt="" width="48" height="48" style="display: block; border-radius: 8px; object-fit: cover;" />`
                : `<div style="width: 48px; height: 48px; border-radius: 8px; background: #f5f5f5;"></div>`
            }
          </td>
          <td style="padding: 8px 0 8px 12px; font-size: 14px; color: #171717; vertical-align: top;">
            ${escapeHtml(item.name)}${item.variantLabel ? ` <span style="color: #a3a3a3;">(${escapeHtml(item.variantLabel)})</span>` : ''}
            <div style="margin-top: 2px; font-size: 12px; color: #a3a3a3;">×${item.quantity}</div>
          </td>
          <td style="padding: 8px 0; font-size: 14px; color: #404040; text-align: right; white-space: nowrap; vertical-align: top;">
            ${formatPHP(item.lineTotalCents)}
          </td>
        </tr>
      `,
    )
    .join('')

  const breakdownRow = (label: string, value: string, emphasize = false) => `
    <tr>
      <td style="padding: 3px 0; font-size: ${emphasize ? '15px' : '13px'}; color: ${emphasize ? '#171717' : '#737373'}; font-weight: ${emphasize ? '600' : '400'};">
        ${label}
      </td>
      <td style="padding: 3px 0; font-size: ${emphasize ? '15px' : '13px'}; color: ${emphasize ? '#171717' : '#404040'}; font-weight: ${emphasize ? '600' : '400'}; text-align: right;">
        ${value}
      </td>
    </tr>
  `

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

      <table style="width: 100%; border-collapse: collapse; border-top: 1px solid #e5e5e5; padding-top: 8px; margin-top: 4px;">
        ${breakdownRow('Subtotal', formatPHP(input.subtotalCents))}
        ${breakdownRow('Shipping', formatPHP(input.shippingCents))}
        ${input.discountCents > 0 ? breakdownRow('Discount', `-${formatPHP(input.discountCents)}`) : ''}
        ${breakdownRow('Total', formatPHP(input.totalCents), true)}
      </table>

      <a href="${escapeHtml(input.trackingUrl)}" style="display: inline-block; background: #0a0a0a; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 999px; margin-top: 16px;">
        View order
      </a>
      <p style="margin-top: 10px; font-size: 12px; line-height: 1.5; color: #a3a3a3;">
        To view and track your order, or to cancel it, click View order above.
      </p>
    </div>
  `
}

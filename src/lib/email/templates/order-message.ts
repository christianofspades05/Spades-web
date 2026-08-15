function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Preserves the staff-written line breaks (a plain textarea, not rich
 *  text) as real paragraph breaks in the rendered email. */
function messageToHtml(message: string): string {
  return message
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p style="font-size: 15px; line-height: 1.6; color: #404040; white-space: pre-line;">${escapeHtml(paragraph)}</p>`,
    )
    .join('\n')
}

export interface OrderMessageEmailInput {
  orderNumber: string
  message: string
}

export function orderMessageEmailHtml(input: OrderMessageEmailInput): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 20px; color: #171717;">
      <p style="font-size: 13px; color: #737373; text-transform: uppercase; letter-spacing: 0.04em;">
        Order ${escapeHtml(input.orderNumber)}
      </p>
      ${messageToHtml(input.message)}
      <p style="font-size: 13px; line-height: 1.6; color: #a3a3a3; margin-top: 24px;">
        Reply directly to this email and we'll get back to you.
      </p>
    </div>
  `
}

import { formatCents } from '#/lib/utils/money'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface EventRegistrationConfirmationEmailInput {
  eventName: string
  locationName: string
  startsAt: string
  fullName: string
  feeCents: number
}

export function eventRegistrationConfirmationSubject(
  eventName: string,
): string {
  return `You're registered — ${eventName}`
}

export function eventRegistrationConfirmationHtml(
  input: EventRegistrationConfirmationEmailInput,
): string {
  const formattedDate = new Date(input.startsAt).toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  })

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 20px; color: #171717;">
      <p style="font-size: 16px;">You're in, ${escapeHtml(input.fullName)}!</p>
      <p style="font-size: 15px; line-height: 1.6; color: #404040;">
        Your spot for <strong>${escapeHtml(input.eventName)}</strong> is confirmed.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; border-top: 1px solid #e5e5e5; padding-top: 8px;">
        <tr>
          <td style="padding: 6px 0; font-size: 13px; color: #737373;">When</td>
          <td style="padding: 6px 0; font-size: 13px; color: #171717; text-align: right;">${escapeHtml(formattedDate)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 13px; color: #737373;">Where</td>
          <td style="padding: 6px 0; font-size: 13px; color: #171717; text-align: right;">${escapeHtml(input.locationName)}</td>
        </tr>
        ${
          input.feeCents > 0
            ? `<tr>
                <td style="padding: 6px 0; font-size: 13px; color: #737373;">Fee paid</td>
                <td style="padding: 6px 0; font-size: 13px; color: #171717; text-align: right;">${formatCents(input.feeCents, 'PHP')}</td>
              </tr>`
            : ''
        }
      </table>

      <p style="margin-top: 10px; font-size: 12px; line-height: 1.5; color: #a3a3a3;">
        See you there!
      </p>
    </div>
  `
}

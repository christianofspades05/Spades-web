import { formatCents } from '#/lib/utils/money'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface EventSlotReservedEmailInput {
  eventName: string
  locationName: string
  locationMapUrl: string | null
  startsAt: string
  endsAt: string
  fullName: string
  feeCents: number
}

/**
 * Sent immediately on registering for a PAID event — before payment is
 * confirmed, so a guest isn't left wondering whether anything happened
 * while Xendit's invoice page loads. The actual "you're confirmed" email
 * (event-registration-confirmation.ts) only goes out once payment is
 * verified; a free event skips this one entirely since reserve_event_slot
 * already confirms it in the same request (see server/events/register.ts).
 */
export function eventSlotReservedSubject(eventName: string): string {
  return `Your slot is reserved — ${eventName}`
}

export function eventSlotReservedHtml(
  input: EventSlotReservedEmailInput,
): string {
  const start = new Date(input.startsAt)
  const end = new Date(input.endsAt)
  const dateOpts = {
    dateStyle: 'full',
    timeZone: 'Asia/Manila',
  } satisfies Intl.DateTimeFormatOptions
  const timeOpts = {
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  } satisfies Intl.DateTimeFormatOptions
  const startDate = start.toLocaleDateString('en-US', dateOpts)
  const endDate = end.toLocaleDateString('en-US', dateOpts)
  const startTime = start.toLocaleTimeString('en-US', timeOpts)
  const endTime = end.toLocaleTimeString('en-US', timeOpts)
  const formattedDate =
    startDate === endDate
      ? `${startDate}, ${startTime} – ${endTime}`
      : `${startDate}, ${startTime} – ${endDate}, ${endTime}`

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 20px; color: #171717;">
      <p style="font-size: 16px;">Hi ${escapeHtml(input.fullName)},</p>
      <p style="font-size: 15px; line-height: 1.6; color: #404040;">
        We've reserved your slot for <strong>${escapeHtml(input.eventName)}</strong> while your payment is being processed.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; border-top: 1px solid #e5e5e5; padding-top: 8px;">
        <tr>
          <td style="padding: 6px 0; font-size: 13px; color: #737373;">When</td>
          <td style="padding: 6px 0; font-size: 13px; color: #171717; text-align: right;">${escapeHtml(formattedDate)}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 13px; color: #737373;">Where</td>
          <td style="padding: 6px 0; font-size: 13px; color: #171717; text-align: right;">
            ${
              input.locationMapUrl
                ? `<a href="${escapeHtml(input.locationMapUrl)}" style="color: #171717;">${escapeHtml(input.locationName)}</a>`
                : escapeHtml(input.locationName)
            }
          </td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 13px; color: #737373;">Fee</td>
          <td style="padding: 6px 0; font-size: 13px; color: #171717; text-align: right;">${formatCents(input.feeCents, 'PHP')}</td>
        </tr>
      </table>

      <p style="margin-top: 10px; font-size: 12px; line-height: 1.5; color: #a3a3a3;">
        You'll get a separate email once your payment is confirmed. If you didn't finish paying, your slot may be released after a short wait.
      </p>
    </div>
  `
}

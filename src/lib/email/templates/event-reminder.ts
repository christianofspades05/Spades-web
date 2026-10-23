function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface EventReminderEmailInput {
  eventName: string
  locationName: string
  locationMapUrl: string | null
  startsAt: string
  endsAt: string
  fullName: string
  cancelUrl: string
}

/**
 * Sent manually by staff, day-of (see sendEventReminders in
 * server/admin/events.ts) — not automated/cron-triggered. Includes a
 * cancelUrl (cancel_token looked up directly, see this migration's own
 * comment) so a registrant who can no longer make it can free their slot
 * without staff having to do it for them.
 */
export function eventReminderSubject(eventName: string): string {
  return `Reminder: ${eventName} is today`
}

export function eventReminderHtml(input: EventReminderEmailInput): string {
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
        Just a reminder — <strong>${escapeHtml(input.eventName)}</strong> is happening today.
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
      </table>

      <p style="font-size: 14px; line-height: 1.6; color: #404040;">
        See you there! Can't make it anymore?
      </p>
      <a href="${escapeHtml(input.cancelUrl)}" style="display: inline-block; margin-top: 4px; padding: 10px 20px; border-radius: 999px; background: #171717; color: #ffffff; font-size: 13px; font-weight: 600; text-decoration: none;">
        Cancel my slot
      </a>
    </div>
  `
}

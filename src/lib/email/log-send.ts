/**
 * Records one row per successful send in email_sends (see
 * 0038_email_sends_log.sql) — what the admin Email page's send-count/
 * conversion-rate stats are computed from (server/admin/email-automations.ts).
 * Called only after sendEmail() itself has succeeded, matching the "only
 * mark it done once it actually went out" discipline each cron already uses
 * for its own per-cart/order/customer flag.
 */
import type { getSupabaseAdminClient } from '#/lib/supabase/admin'

export async function logEmailSend(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  automationId: string,
  recipientEmail: string,
  discountId: string | null,
): Promise<void> {
  const { error } = await admin.from('email_sends').insert({
    email_automation_id: automationId,
    recipient_email: recipientEmail,
    discount_id: discountId,
  })
  if (error) throw error
}

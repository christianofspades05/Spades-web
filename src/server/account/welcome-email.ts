/**
 * Fires the "welcome" lifecycle email (see admin Email page) after a
 * customer's first successful sign-in — called from both signup.tsx
 * (email/password) and auth/callback.tsx (Google), since Supabase treats a
 * first-time OAuth sign-in the same as any other login rather than a
 * distinct "signup" event. Idempotent via customers.welcome_emailed_at, so
 * it's safe to call on every subsequent login too — the common case is
 * always a no-op after the first real send.
 */
import { createServerFn } from '@tanstack/react-start'
import { requireCustomer } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { sendEmail } from '#/lib/email/resend'
import { renderEmailBlocks } from '#/lib/email/blocks'
import { mintPerRecipientDiscount } from '#/lib/email/mint-discount'
import { logEmailSend } from '#/lib/email/log-send'

export const sendWelcomeEmailIfDue = createServerFn({ method: 'POST' }).handler(
  async (): Promise<void> => {
    const customer = await requireCustomer()
    if (customer.welcome_emailed_at) return

    const admin = getSupabaseAdminClient()
    const { data: automation, error } = await admin
      .from('email_automations')
      .select('*')
      .eq('event_type', 'welcome')
      .single()
    if (error) throw error
    if (!automation.is_active) return

    // Freshly minted per recipient, never the template's own code — see
    // mint-discount.ts's doc comment for why.
    const discount = automation.discount_id
      ? await mintPerRecipientDiscount(
          admin,
          automation.discount_id,
          automation.id,
        )
      : null

    await sendEmail({
      to: customer.email,
      subject: automation.subject,
      html: renderEmailBlocks(automation.blocks, {
        placeholders: {
          customerFirstName:
            (customer.full_name ?? '').split(' ')[0] || 'there',
        },
        discount,
      }),
    })

    // Only persist once the email has actually gone out — if sendEmail
    // throws above, the next login retries instead of skipping forever.
    const { error: updateError } = await admin
      .from('customers')
      .update({ welcome_emailed_at: new Date().toISOString() })
      .eq('id', customer.id)
    if (updateError) throw updateError

    await logEmailSend(
      admin,
      automation.id,
      customer.email,
      discount?.id ?? null,
    )
  },
)

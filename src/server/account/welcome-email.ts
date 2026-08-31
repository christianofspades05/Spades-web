/**
 * Fires the "welcome" lifecycle email (see admin Email page) after a
 * customer's first successful sign-in — called from both signup.tsx
 * (email/password) and auth/callback.tsx (Google), since Supabase treats a
 * first-time OAuth sign-in the same as any other login rather than a
 * distinct "signup" event. Idempotent via customers.welcome_emailed_at, so
 * it's safe to call on every subsequent login too — the common case is
 * always a no-op after the first real send.
 *
 * auth/callback.tsx in particular calls this from more than one trigger for
 * the same sign-in (its onAuthStateChange listener AND an immediate
 * getSession() check, both racing) — confirmed live that this produced real
 * quadruple-sends to 22 customers (all 4 rows within a few seconds of each
 * other) before the claim below existed, because the *check* and the
 * *send* weren't atomic: every concurrent caller could see
 * welcome_emailed_at still null before any of them finished sending. The
 * atomic conditional UPDATE below closes that gap — only the caller whose
 * UPDATE actually matches a row wins the right to send; every other
 * concurrent caller sees zero rows affected and returns immediately.
 */
import { createServerFn } from '@tanstack/react-start'
import { requireCustomer } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { sendEmail, withDisplayName } from '#/lib/email/resend'
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

    // Claim the right to send before doing any of the slow async work
    // below — `.is('welcome_emailed_at', null)` means this UPDATE only
    // actually matches (and returns a row) for whichever concurrent caller
    // gets here first.
    const { data: claimed, error: claimError } = await admin
      .from('customers')
      .update({ welcome_emailed_at: new Date().toISOString() })
      .eq('id', customer.id)
      .is('welcome_emailed_at', null)
      .select('id')
      .maybeSingle()
    if (claimError) throw claimError
    if (!claimed) return

    try {
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
        from: withDisplayName(
          'Spades Official Welcome',
          process.env.RESEND_FROM_EMAIL_WELCOME,
        ),
        html: renderEmailBlocks(automation.blocks, {
          placeholders: {
            customerFirstName:
              (customer.full_name ?? '').split(' ')[0] || 'there',
          },
          discount,
        }),
      })

      await logEmailSend(
        admin,
        automation.id,
        customer.email,
        discount?.id ?? null,
      )
    } catch (err) {
      // Release the claim so the next login retries instead of skipping
      // forever — same retry contract as before this function claimed
      // up front rather than only after a successful send.
      await admin
        .from('customers')
        .update({ welcome_emailed_at: null })
        .eq('id', customer.id)
      throw err
    }
  },
)

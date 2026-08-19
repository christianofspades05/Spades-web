/**
 * The homepage email-capture popup ("get a discount code") — reuses the
 * exact same 'welcome' email_automations row admin configures for real
 * account signups (see server/account/welcome-email.ts), just triggered by
 * an anonymous visitor typing their email in instead of completing a real
 * signup. A visitor who submits gets a lightweight guest customers row
 * (is_guest: true), so:
 *   - they can never claim a second popup code (blocked by the same
 *     lower(email) unique index every customer row already has),
 *   - if they later create a real account with the same email,
 *     handle_new_auth_user's existing guest-row lookup merges into this
 *     same row instead of double-sending the welcome email/discount.
 */
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { sendEmail, withDisplayName } from '#/lib/email/resend'
import { renderEmailBlocks } from '#/lib/email/blocks'
import { mintPerRecipientDiscount } from '#/lib/email/mint-discount'
import { logEmailSend } from '#/lib/email/log-send'
import { createPromiseCache } from '#/lib/utils/cache'

const POPUP_CODE_EXPIRY_DAYS = 1

// Same rationale as storefront/maintenance.ts's cache — checked on every
// page load, rarely changes. Not brand-scoped, so a single fixed key.
const EMAIL_CAPTURE_POPUP_CACHE_TTL_MS = 30_000
const emailCapturePopupCache = createPromiseCache<boolean>(
  EMAIL_CAPTURE_POPUP_CACHE_TTL_MS,
)

/**
 * Whether the popup should even render — the admin hasn't necessarily
 * turned the welcome automation on or attached a discount template yet.
 *
 * Wrapped in createServerOnlyFn, not just a plain function — see
 * domain.ts's checkNonCanonicalVercelHostRedirect doc comment for the full
 * reasoning.
 */
export const resolveEmailCapturePopupEnabled = createServerOnlyFn(
  async (): Promise<boolean> => {
    return emailCapturePopupCache.get('default', async () => {
      const admin = getSupabaseAdminClient()
      const { data: automation, error } = await admin
        .from('email_automations')
        .select('is_active, discount_id')
        .eq('event_type', 'welcome')
        .maybeSingle()
      if (error) throw error
      return Boolean(automation?.is_active && automation.discount_id)
    })
  },
)

export const getEmailCapturePopupEnabled = createServerFn({
  method: 'GET',
}).handler((): Promise<boolean> => resolveEmailCapturePopupEnabled())

export type EmailCaptureResult =
  | { status: 'sent' }
  | { status: 'already_customer' }
  | { status: 'unavailable' }

export const submitEmailCapture = createServerFn({ method: 'POST' })
  .validator(z.object({ email: z.string().trim().toLowerCase().email() }))
  .handler(async ({ data }): Promise<EmailCaptureResult> => {
    const admin = getSupabaseAdminClient()

    const { data: existing, error: existingError } = await admin
      .from('customers')
      .select('id')
      .ilike('email', data.email)
      .maybeSingle()
    if (existingError) throw existingError
    if (existing) return { status: 'already_customer' }

    const { data: automation, error: automationError } = await admin
      .from('email_automations')
      .select('*')
      .eq('event_type', 'welcome')
      .single()
    if (automationError) throw automationError
    if (!automation.is_active || !automation.discount_id) {
      return { status: 'unavailable' }
    }

    const { data: customer, error: insertError } = await admin
      .from('customers')
      .insert({
        email: data.email,
        is_guest: true,
        marketing_opt_in: true,
        email_verified: false,
      })
      .select('id')
      .single()
    if (insertError) {
      // Unique violation on lower(email) — someone else's concurrent
      // submission (or an existing row the .ilike check above raced
      // against) won first. Same outcome either way: no second code.
      if (insertError.code === '23505') return { status: 'already_customer' }
      throw insertError
    }

    // Freshly minted per recipient, never the template's own code — see
    // mint-discount.ts's doc comment for why. 24-hour expiry, unlike the
    // real-signup welcome send which never expires.
    const discount = await mintPerRecipientDiscount(
      admin,
      automation.discount_id,
      automation.id,
      { expiresInDays: POPUP_CODE_EXPIRY_DAYS },
    )

    await sendEmail({
      to: data.email,
      subject: automation.subject,
      from: withDisplayName(
        'Spades Official Welcome',
        process.env.RESEND_FROM_EMAIL_WELCOME,
      ),
      html: renderEmailBlocks(automation.blocks, {
        placeholders: { customerFirstName: 'there' },
        discount,
      }),
    })

    // Only persisted once the email has actually gone out, matching every
    // other lifecycle send's discipline (see welcome-email.ts).
    const { error: updateError } = await admin
      .from('customers')
      .update({ welcome_emailed_at: new Date().toISOString() })
      .eq('id', customer.id)
    if (updateError) throw updateError

    await logEmailSend(admin, automation.id, data.email, discount?.id ?? null)

    return { status: 'sent' }
  })

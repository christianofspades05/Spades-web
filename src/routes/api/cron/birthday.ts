/**
 * Birthday email. Recurring, not delay-based, so this is meant to run once
 * daily via an external scheduler (cron-job.org), sending
 * `Authorization: Bearer $CRON_SECRET`. NOT added to vercel.json's cron
 * list, already at this Vercel plan's 2-daily-cron cap.
 *
 * Only sent to customers who've opted in to marketing
 * (customers.marketing_opt_in) — unlike abandoned-cart/review-requests,
 * there's no per-customer unsubscribe-token flow for this one (the existing
 * /unsubscribe/:token route is keyed off carts.unsubscribe_token, a
 * guest-cart concept that doesn't apply here), so respecting the opt-in
 * flag already on the customer's account is the gate instead.
 *
 * Content/discount come from the `email_automations` row
 * (event_type = 'birthday'), editable from the admin Email page. Skips
 * entirely if that automation is turned off.
 */
import { createFileRoute } from '@tanstack/react-router'
import { renderEmailBlocks } from '#/lib/email/blocks'
import { mintPerRecipientDiscount } from '#/lib/email/mint-discount'
import { logEmailSend } from '#/lib/email/log-send'

// getSupabaseAdminClient and sendEmail are imported dynamically inside the
// handler below, not at the top level — see review-requests.ts's identical
// comment.

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('CRON_SECRET is not set — rejecting all cron requests.')
    return false
  }
  return request.headers.get('authorization') === `Bearer ${expected}`
}

export const Route = createFileRoute('/api/cron/birthday')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthorized(request)) {
          return new Response('Unauthorized', { status: 401 })
        }

        const { getSupabaseAdminClient } = await import('#/lib/supabase/admin')
        const { sendEmail } = await import('#/lib/email/resend')
        const admin = getSupabaseAdminClient()

        const { data: automation, error: automationError } = await admin
          .from('email_automations')
          .select('*')
          .eq('event_type', 'birthday')
          .single()
        if (automationError) throw automationError
        if (!automation.is_active) {
          return Response.json({ skipped: 'automation is inactive' })
        }

        const { data: candidates, error } = await admin
          .from('customers')
          .select(
            'id, email, full_name, date_of_birth, birthday_last_emailed_at',
          )
          .not('date_of_birth', 'is', null)
          .eq('marketing_opt_in', true)
        if (error) throw error

        const today = new Date()
        const todayMonth = today.getUTCMonth()
        const todayDate = today.getUTCDate()
        const todayYear = today.getUTCFullYear()

        let sent = 0
        const failures: { customerId: string; error: string }[] = []

        for (const customer of candidates) {
          if (!customer.date_of_birth) continue
          const dob = new Date(customer.date_of_birth)
          if (
            dob.getUTCMonth() !== todayMonth ||
            dob.getUTCDate() !== todayDate
          ) {
            continue
          }

          const lastSentYear = customer.birthday_last_emailed_at
            ? new Date(customer.birthday_last_emailed_at).getUTCFullYear()
            : null
          if (lastSentYear === todayYear) continue

          try {
            // Freshly minted per recipient, never the template's own code —
            // see mint-discount.ts's doc comment for why.
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

            const { error: updateError } = await admin
              .from('customers')
              .update({
                birthday_last_emailed_at: today.toISOString().slice(0, 10),
              })
              .eq('id', customer.id)
            if (updateError) throw updateError

            await logEmailSend(
              admin,
              automation.id,
              customer.email,
              discount?.id ?? null,
            )

            sent += 1
          } catch (err) {
            failures.push({
              customerId: customer.id,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        return Response.json({
          scanned: candidates.length,
          sent,
          failures,
        })
      },
    },
  },
})

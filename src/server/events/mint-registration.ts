/**
 * Confirms a pending event registration (mint_event_registration RPC — see
 * its own comment in 0106_community_events.sql for the idempotent/
 * recoverable design) and sends the confirmation email. Shared by the
 * Xendit webhook's PAID branch and its own live-re-check recovery path,
 * same reasoning as server/checkout/mint-order.ts for orders.
 */
import type { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type { CommunityEventRow } from '#/types/community-events'

type Admin = ReturnType<typeof getSupabaseAdminClient>

export async function mintEventRegistration(
  admin: Admin,
  registrationId: string,
): Promise<void> {
  const { data: registration, error: mintError } = await admin.rpc(
    'mint_event_registration',
    { p_registration_id: registrationId },
  )
  if (mintError) throw mintError

  const { data: event, error: eventError } = await admin
    .from('community_events')
    .select('*')
    .eq('id', registration.event_id)
    .single<CommunityEventRow>()
  if (eventError) throw eventError

  try {
    const { sendEmail, withDisplayName } = await import('#/lib/email/resend')
    const {
      eventRegistrationConfirmationHtml,
      eventRegistrationConfirmationSubject,
    } = await import('#/lib/email/templates/event-registration-confirmation')

    await sendEmail({
      to: registration.email,
      subject: eventRegistrationConfirmationSubject(event.name),
      from: withDisplayName(
        'Spades Official',
        process.env.RESEND_FROM_EMAIL_ORDERS,
      ),
      html: eventRegistrationConfirmationHtml({
        eventName: event.name,
        locationName: event.location_name,
        startsAt: event.starts_at,
        endsAt: event.ends_at,
        fullName: registration.full_name,
        feeCents: registration.fee_cents,
      }),
    })
  } catch (err) {
    console.error('Failed to send event registration confirmation email:', err)
  }
}

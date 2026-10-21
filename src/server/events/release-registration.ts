/**
 * Gives back a pending event registration's slot on genuine payment
 * expiry/failure — soft-delete only (release_event_slot RPC sets
 * released_at, never deletes the row), same reasoning as
 * server/checkout/release-reservation.ts: a payment provider's own
 * "expired/failed" status has been observed arriving before a genuinely
 * successful payment's confirmation, so a late PAID webhook needs
 * something left to recover.
 */
import type { getSupabaseAdminClient } from '#/lib/supabase/admin'

export async function releaseEventRegistration(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  registrationId: string,
): Promise<void> {
  const { error } = await admin.rpc('release_event_slot', {
    p_registration_id: registrationId,
  })
  if (error) throw error
}

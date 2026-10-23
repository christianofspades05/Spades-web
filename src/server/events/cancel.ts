/**
 * Public, no-account self-serve cancellation — reached via the cancel link
 * in a reminder email (event-reminder.ts). Looked up purely by
 * cancel_token (opaque random string, see this migration's own comment on
 * why that's safe without further auth), never by registration id, so a
 * guessed/enumerated uuid alone can't cancel someone else's slot.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type { CommunityEventRow } from '#/types/community-events'

const tokenSchema = z.object({ token: z.string().min(1) })

export interface CancelInfo {
  eventName: string
  startsAt: string
  endsAt: string
  locationName: string
  fullName: string
  alreadyCancelled: boolean
}

async function loadRegistrationAndEvent(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  token: string,
) {
  const { data: reg, error } = await admin
    .from('event_registrations')
    .select('id, event_id, full_name, status')
    .eq('cancel_token', token)
    .maybeSingle()
  if (error) throw error
  if (!reg) return null

  const { data: event, error: eventError } = await admin
    .from('community_events')
    .select('*')
    .eq('id', reg.event_id)
    .single<CommunityEventRow>()
  if (eventError) throw eventError

  return { reg, event }
}

/** Read-only lookup for the confirmation page — loading this link never
 *  cancels anything on its own (a link scanner or an accidental open
 *  shouldn't release someone's slot); only cancelRegistrationByToken does,
 *  gated behind an explicit button click. */
export const getCancelInfoByToken = createServerFn({ method: 'GET' })
  .validator(tokenSchema)
  .handler(async ({ data }): Promise<CancelInfo | null> => {
    const admin = getSupabaseAdminClient()
    const found = await loadRegistrationAndEvent(admin, data.token)
    if (!found) return null

    return {
      eventName: found.event.name,
      startsAt: found.event.starts_at,
      endsAt: found.event.ends_at,
      locationName: found.event.location_name,
      fullName: found.reg.full_name,
      alreadyCancelled: found.reg.status === 'released',
    }
  })

export const cancelRegistrationByToken = createServerFn({ method: 'POST' })
  .validator(tokenSchema)
  .handler(async ({ data }): Promise<CancelInfo | null> => {
    const admin = getSupabaseAdminClient()
    const found = await loadRegistrationAndEvent(admin, data.token)
    if (!found) return null

    if (found.reg.status !== 'released') {
      const { error: removeError } = await admin.rpc(
        'remove_event_registration',
        { p_registration_id: found.reg.id },
      )
      if (removeError) throw removeError
    }

    return {
      eventName: found.event.name,
      startsAt: found.event.starts_at,
      endsAt: found.event.ends_at,
      locationName: found.event.location_name,
      fullName: found.reg.full_name,
      alreadyCancelled: true,
    }
  })

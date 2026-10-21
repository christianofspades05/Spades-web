import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSupabaseServerClient } from '#/lib/supabase/server'
import type { CommunityEventRow } from '#/types/community-events'

/** Upcoming, active community events — public, no staff auth, RLS-scoped
 *  (see "public read active events" policy, 0106_community_events.sql) so
 *  this stays safe even if called from anywhere other than the Spades
 *  storefront by mistake. Past events (starts_at already elapsed) are
 *  deliberately excluded — this is a "what's coming up" listing, not an
 *  events archive. */
export const listUpcomingEvents = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CommunityEventRow[]> => {
    const supabase = getSupabaseServerClient()
    const { data, error } = await supabase
      .from('community_events')
      .select('*')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
    if (error) throw error
    return data
  },
)

export const getEventBySlug = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }): Promise<CommunityEventRow | null> => {
    const supabase = getSupabaseServerClient()
    const { data: event, error } = await supabase
      .from('community_events')
      .select('*')
      .eq('slug', data.slug)
      .maybeSingle()
    if (error) throw error
    return event
  })

export interface NearbyEventCandidate {
  slug: string
  name: string
  latitude: number
  longitude: number
}

/** Upcoming + active events that have coordinates set — the small, cheap
 *  payload NearbyEventPopup.tsx fetches once per page load to check
 *  client-side (via the visitor's own browser-geolocated position,
 *  something only the client can know) whether any are nearby. Events
 *  with no latitude/longitude set never appear here, same as they never
 *  show in admin/community's "near you" reasoning. */
export const getNearbyEventCandidates = createServerFn({
  method: 'GET',
}).handler(async (): Promise<NearbyEventCandidate[]> => {
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase
    .from('community_events')
    .select('slug, name, latitude, longitude')
    .gte('starts_at', new Date().toISOString())
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
  if (error) throw error
  return data
})

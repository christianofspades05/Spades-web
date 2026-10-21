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

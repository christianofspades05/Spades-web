import { createServerFn } from '@tanstack/react-start'
import { recordVisitSchema, recordPresenceSchema } from '#/lib/validation/analytics'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'

/**
 * Public, unauthenticated write — called from every storefront page load so
 * the admin Home dashboard can show real visitor/conversion-rate numbers.
 * No session, no PII: `visitorId` is a random id the browser generates and
 * keeps in localStorage, not tied to any customer account.
 */
export const recordVisit = createServerFn({ method: 'POST' })
  .validator(recordVisitSchema)
  .handler(async ({ data }) => {
    const admin = getSupabaseAdminClient()
    const { error } = await admin.from('storefront_visits').insert({
      visitor_id: data.visitorId,
      path: data.path,
      event_type: data.eventType,
      product_id: data.productId,
      metadata: data.metadata,
      brand: data.brand,
    })
    if (error) throw error
    return { ok: true as const }
  })

/**
 * Public, unauthenticated heartbeat — called on an interval while a
 * storefront tab is open so the admin Home dashboard can show a live
 * viewer count. Upserts (not inserts): storefront_presence holds current
 * state, one row per visitor, not a history log like storefront_visits.
 */
export const recordPresence = createServerFn({ method: 'POST' })
  .validator(recordPresenceSchema)
  .handler(async ({ data }) => {
    const admin = getSupabaseAdminClient()
    const { error } = await admin.from('storefront_presence').upsert(
      {
        visitor_id: data.visitorId,
        path: data.path,
        brand: data.brand,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'visitor_id' },
    )
    if (error) throw error
    return { ok: true as const }
  })

import { createServerFn } from '@tanstack/react-start'
import { recordVisitSchema } from '#/lib/validation/analytics'
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
    })
    if (error) throw error
    return { ok: true as const }
  })

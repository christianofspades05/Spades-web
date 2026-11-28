import { createServerFn } from '@tanstack/react-start'
import { setCookie } from '@tanstack/react-start/server'
import { z } from 'zod'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'

/**
 * Creator link tracking: https://<store>/?ref=<CODE> (migration 0138).
 *
 * Landing with a valid code sets a 30-day first-party cookie and logs one
 * storefront_visits row (event_type 'creator_link_visit', metadata
 * {creator_id} — no PII). At checkout, an order with no creator code but a
 * valid cookie is attributed to that creator as a 'link' order — see
 * creator-ref.server.ts and creator_capture_attribution in 0138.
 */

/** Called once when a shopper lands with ?ref=CODE (VisitTracker.tsx). */
export const recordCreatorLinkVisit = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      ref: z.string().trim().min(1).max(64),
      visitorId: z.string().uuid(),
      path: z.string().trim().min(1).max(500),
    }),
  )
  .handler(async ({ data }) => {
    const admin = getSupabaseAdminClient()
    const {
      CREATOR_REF_COOKIE,
      REF_COOKIE_MAX_AGE_SECONDS,
      resolveCreatorRef,
    } = await import('./creator-ref.server')
    const { getStorefrontScope } = await import('#/server/storefront/domain')
    const scope = await getStorefrontScope()
    const ref = await resolveCreatorRef(admin, data.ref, scope.brand)
    // Unknown codes are silently ignored — same response either way.
    if (!ref) return { ok: true }
    setCookie(CREATOR_REF_COOKIE, ref.code, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: REF_COOKIE_MAX_AGE_SECONDS,
    })
    const { error } = await admin.from('storefront_visits').insert({
      visitor_id: data.visitorId,
      path: data.path,
      event_type: 'creator_link_visit',
      metadata: { creator_id: ref.creatorId },
      brand: scope.brand,
    })
    if (error) throw error
    return { ok: true }
  })

import { createServerFn } from '@tanstack/react-start'
import { submitStoreFeedbackSchema } from '#/lib/validation/feedback'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'

/**
 * Public, unauthenticated write from the "Have any recommendations?" form on
 * /reviews — same convention as recordVisit (src/server/analytics/track.ts):
 * no session required, insert goes through the service-role admin client
 * since store_feedback has RLS enabled with no anon policies.
 */
export const submitStoreFeedback = createServerFn({ method: 'POST' })
  .validator(submitStoreFeedbackSchema)
  .handler(async ({ data }) => {
    const admin = getSupabaseAdminClient()
    const { error } = await admin.from('store_feedback').insert({
      name: data.name || null,
      email: data.email,
      phone: data.phone || null,
      comment: data.comment || null,
    })
    if (error) throw error
    return { ok: true as const }
  })

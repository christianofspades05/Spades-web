import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'

const unsubscribeTokenSchema = z.object({ token: z.string().min(1) })

/**
 * Looks up which email a token belongs to and opts that address out of
 * future marketing emails (email_unsubscribes, not the cart itself — the
 * thing being acted on is the address, so it stays unsubscribed even from
 * a brand-new guest cart with no relationship to the one that sent this).
 * No `status = 'active'` filter (unlike resumeCartByToken) — unsubscribing
 * should keep working even after the cart converts to an order.
 */
export const unsubscribeByToken = createServerFn({ method: 'GET' })
  .validator(unsubscribeTokenSchema)
  .handler(async ({ data }): Promise<{ email: string | null }> => {
    const admin = getSupabaseAdminClient()
    const { data: cart, error } = await admin
      .from('carts')
      .select('email')
      .eq('unsubscribe_token', data.token)
      .maybeSingle()
    if (error) throw error
    if (!cart?.email) return { email: null }

    const { error: upsertError } = await admin
      .from('email_unsubscribes')
      .upsert({ email: cart.email }, { onConflict: 'email', ignoreDuplicates: true })
    if (upsertError) throw upsertError

    return { email: cart.email }
  })

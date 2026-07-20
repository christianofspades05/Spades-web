import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { setCartToken } from '#/lib/cart/cart-cookie'

const resumeCartTokenSchema = z.object({ token: z.string().min(1) })

/**
 * Adopts a cart's session_token into whoever's browser holds the recovery
 * link (e.g. an abandoned-cart email opened on a different device, or
 * after the original cookie expired/got cleared) by re-issuing it as this
 * request's own cart cookie. Only resumes carts still `status = 'active'`
 * — if it already converted (customer checked out some other way first),
 * silently re-adopting a dead cart would just leave them looking at a cart
 * that behaves oddly; falling through to a normal empty /cart is better.
 */
export const resumeCartByToken = createServerFn({ method: 'GET' })
  .validator(resumeCartTokenSchema)
  .handler(async ({ data }): Promise<{ resumed: boolean }> => {
    const admin = getSupabaseAdminClient()
    const { data: cart, error } = await admin
      .from('carts')
      .select('session_token')
      .eq('recovery_token', data.token)
      .eq('status', 'active')
      .maybeSingle()
    if (error) throw error
    if (!cart?.session_token) return { resumed: false }

    setCartToken(cart.session_token)
    return { resumed: true }
  })

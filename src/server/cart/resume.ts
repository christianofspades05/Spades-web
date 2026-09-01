import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { setCartToken } from '#/lib/cart/cart-cookie'
import { findValidDiscountByCode } from './discount'

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
      .select('id, session_token, discount_id, abandoned_cart_discount_id')
      .eq('recovery_token', data.token)
      .eq('status', 'active')
      .maybeSingle()
    if (error) throw error
    if (!cart?.session_token) return { resumed: false }

    setCartToken(cart.session_token)

    // Auto-apply the code the email actually showed them — previously the
    // customer had to notice it in the email and manually re-type it at
    // checkout, which most never did (confirmed live: only 15% of orders
    // that came back through a recovered cart actually used the code,
    // even though the cart itself clearly converted). Skipped if the cart
    // already has some other discount applied, or if this one has since
    // expired/been deactivated/hit its cap — findValidDiscountByCode
    // throws for any of those, and a failed auto-apply should never block
    // resuming the cart itself.
    if (cart.abandoned_cart_discount_id && !cart.discount_id) {
      try {
        const { data: discountRow, error: discountError } = await admin
          .from('discounts')
          .select('code')
          .eq('id', cart.abandoned_cart_discount_id)
          .maybeSingle()
        if (discountError) throw discountError
        if (discountRow?.code) {
          const { data: items, error: itemsError } = await admin
            .from('cart_items')
            .select(
              '*, variant:product_variants(*, product:products(id, slug, name, images))',
            )
            .eq('cart_id', cart.id)
          if (itemsError) throw itemsError
          const discount = await findValidDiscountByCode(
            admin,
            discountRow.code,
            items,
          )
          await admin
            .from('carts')
            .update({ discount_id: discount.id })
            .eq('id', cart.id)
        }
      } catch {
        // Not eligible anymore (expired, cap reached, etc.) — resume the
        // cart anyway, just without the discount.
      }
    }

    return { resumed: true }
  })

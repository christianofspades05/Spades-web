import { createServerFn } from '@tanstack/react-start'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { getCartToken } from '#/lib/cart/cart-cookie'
import { loadCartWithItems } from './internal'
import type { CartWithItems } from './internal'

export const getCart = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CartWithItems | null> => {
    const token = getCartToken()
    if (!token) return null

    const admin = getSupabaseAdminClient()
    const { data: cart, error } = await admin
      .from('carts')
      .select('id')
      .eq('session_token', token)
      .eq('status', 'active')
      .maybeSingle()

    if (error) throw error
    if (!cart) return null

    return loadCartWithItems(admin, cart.id)
  },
)

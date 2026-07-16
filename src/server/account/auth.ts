/**
 * Customer session lookup. Sign-up/sign-in/sign-out/OAuth themselves happen
 * client-side via the browser Supabase client (see routes/account/*.tsx) —
 * this only handles the part that needs per-request cookies, mirroring
 * src/server/admin/auth.ts's getStaffSession.
 */
import { createServerFn } from '@tanstack/react-start'
import { getCurrentCustomer } from '#/lib/auth/session'
import type { Customer } from '#/types/entities'

export const getCustomerSession = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Customer | null> => {
    return getCurrentCustomer()
  },
)

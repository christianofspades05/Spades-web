/**
 * Server-only helpers for resolving "who is calling" from the current
 * request's Supabase auth cookies. Used by server functions and route
 * loaders that need to know the current customer or staff member.
 */
import { getSupabaseServerClient } from '#/lib/supabase/server'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type { Customer, StaffUser } from '#/types/entities'

export async function getAuthUser() {
  const supabase = getSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

/** Resolves the `customers` row linked to the current auth session, if any. */
export async function getCurrentCustomer(): Promise<Customer | null> {
  const user = await getAuthUser()
  if (!user) return null

  const admin = getSupabaseAdminClient()
  const { data, error } = await admin
    .from('customers')
    .select('*')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (error) throw error
  return data
}

/** Resolves the `staff_users` row linked to the current auth session, if any. */
export async function getCurrentStaffUser(): Promise<StaffUser | null> {
  const user = await getAuthUser()
  if (!user) return null

  const admin = getSupabaseAdminClient()
  const { data, error } = await admin
    .from('staff_users')
    .select('*')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw error
  return data
}

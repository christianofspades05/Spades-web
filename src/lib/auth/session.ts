/**
 * Server-only helpers for resolving "who is calling" from the current
 * request's Supabase auth cookies. Used by server functions and route
 * loaders that need to know the current customer or staff member.
 */
import { getCookies } from '@tanstack/react-start/server'
import {
  clearSupabaseSessionCookies,
  getSupabaseServerClient,
} from '#/lib/supabase/server'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type { Customer, StaffUser } from '#/types/entities'

/**
 * A corrupted or stale Supabase session cookie (left over from before a
 * project/key rotation, or a partially-written chunked cookie) doesn't
 * behave like a normal expired session — that resolves to `user: null`
 * cleanly. Instead Supabase's own API can reject the request outright with
 * an edge-level 400, which without this would throw all the way up to
 * every route's CatchBoundary and permanently break the page for that one
 * browser (a plain "log out and back in" doesn't help, since the same bad
 * cookie is what breaks the request in the first place). Treat any failure
 * here as "not signed in" and clear the `sb-*` cookies so the next request
 * starts clean instead of repeating the same crash forever.
 */
function recoverFromBadSession(): null {
  const badCookieNames = Object.keys(getCookies()).filter((name) =>
    name.startsWith('sb-'),
  )
  clearSupabaseSessionCookies(badCookieNames)
  return null
}

export async function getAuthUser() {
  // The whole body is wrapped, not just the network call — a corrupted
  // cookie can throw synchronously too (e.g. while getSupabaseServerClient
  // or @supabase/ssr parses a partially-written chunked cookie), which a
  // narrower try/catch around just `auth.getUser()` would miss entirely.
  try {
    const supabase = getSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user
  } catch {
    return recoverFromBadSession()
  }
}

/** Resolves the `customers` row linked to the current auth session, if any. */
export async function getCurrentCustomer(): Promise<Customer | null> {
  try {
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
  } catch {
    return recoverFromBadSession()
  }
}

/** Resolves the `staff_users` row linked to the current auth session, if any. */
export async function getCurrentStaffUser(): Promise<StaffUser | null> {
  try {
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
  } catch {
    return recoverFromBadSession()
  }
}

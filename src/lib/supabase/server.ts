/**
 * Server-side, per-request Supabase client that acts AS THE SIGNED-IN USER
 * (anon key + the caller's auth cookies). Use this inside server functions /
 * route loaders for anything that should respect RLS and reflect "who is
 * asking" — e.g. reading a customer's own orders.
 *
 * Do NOT use this for operations that must bypass RLS (price/inventory
 * writes, order creation, admin reads across all customers) — use
 * `getSupabaseAdminClient()` from `admin.ts` for those instead.
 *
 * Must be called from within a server function/route request context, since
 * it reads cookies off the in-flight request via @tanstack/react-start.
 */
import { createServerClient } from '@supabase/ssr'
import { deleteCookie, getCookies, setCookie } from '@tanstack/react-start/server'
import type { Database } from '#/types/database.types'

export function getSupabaseServerClient() {
  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_ANON_KEY. Check your .env file against .env.example.',
    )
  }

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        const cookies = getCookies()
        return Object.entries(cookies).map(([name, value]) => ({ name, value }))
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          setCookie(name, value, options)
        }
      },
    },
  })
}

export function clearSupabaseSessionCookies(cookieNames: Array<string>) {
  for (const name of cookieNames) {
    deleteCookie(name)
  }
}

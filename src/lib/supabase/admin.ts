/**
 * Server-only Supabase admin client, authenticated with the SERVICE ROLE KEY.
 * This client bypasses Row Level Security entirely.
 *
 * Rules for using this file:
 *   - Only import it from `src/server/**` code that runs inside a
 *     `createServerFn` handler (or another server-only entry point) —
 *     never from a route component, a `.tsx` client component, or anything
 *     that could be imported into the browser bundle.
 *   - `SUPABASE_SERVICE_ROLE_KEY` must NOT be prefixed with `VITE_`. Vite
 *     only inlines `VITE_*` variables into the client bundle, so keeping
 *     this name un-prefixed is what keeps the key server-only.
 *   - Every write made through this client (prices, inventory, orders,
 *     payments) must be validated server-side first — this client trusts
 *     whatever it's told, by design.
 *
 * The runtime guard below is defense-in-depth: it throws if this client is
 * ever actually requested from a browser context. It deliberately lives
 * inside getSupabaseAdminClient() rather than at module top-level — a
 * throw-on-import would crash the whole page's hydration if this module
 * ever ends up merely *imported* into a client bundle by accident (e.g. a
 * route file that transitively reaches it), even without the function
 * being called. Throwing only on actual use keeps the real protection
 * (this client can never actually run client-side) without that blast radius.
 */
import { createClient } from '@supabase/supabase-js'
import type { Database } from '#/types/database.types'

let adminClient: ReturnType<typeof createClient<Database>> | undefined

export function getSupabaseAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error(
      'getSupabaseAdminClient() was called from a browser context. The service-role client must never run client-side.',
    )
  }

  if (adminClient) return adminClient

  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Check your .env file against .env.example. ' +
        'These must be set as server-only environment variables (no VITE_ prefix).',
    )
  }

  adminClient = createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  return adminClient
}

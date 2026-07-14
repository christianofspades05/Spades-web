/**
 * Browser-side Supabase client. Safe to import from any client component.
 *
 * Uses the anon key only — RLS policies (see supabase/migrations) govern
 * exactly what this client can read/write. Never import the admin client
 * from a file that can end up in the browser bundle.
 */
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '#/types/database.types'

let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined

export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient

  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Check your .env file against .env.example.',
    )
  }

  browserClient = createBrowserClient<Database>(url, anonKey)
  return browserClient
}

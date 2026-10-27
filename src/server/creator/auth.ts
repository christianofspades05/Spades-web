/**
 * Creator portal session lookup. Sign-in/sign-out happen client-side via the
 * browser Supabase client (see routes/creator/login.tsx) — same split as
 * admin/auth.ts for staff.
 */
import { createServerFn } from '@tanstack/react-start'
import { getCurrentCreator } from '#/lib/auth/session'
import type { Creator } from '#/types/creators'

export const getCreatorSession = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Creator | null> => {
    return getCurrentCreator()
  },
)

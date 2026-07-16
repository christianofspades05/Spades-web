/**
 * Staff auth bootstrap + session lookup. Sign-in/sign-out themselves happen
 * client-side via the browser Supabase client (see routes/admin_.login.tsx)
 * — these server functions only handle the parts that need the service-role
 * client or per-request cookies.
 */
import { createServerFn } from '@tanstack/react-start'
import { bootstrapAdminSchema } from '#/lib/validation/admin/auth'
import { getCurrentStaffUser } from '#/lib/auth/session'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type { StaffUser } from '#/types/entities'

export const getStaffSession = createServerFn({ method: 'GET' }).handler(
  async (): Promise<StaffUser | null> => {
    return getCurrentStaffUser()
  },
)

export const hasAnyStaffUser = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => {
    const admin = getSupabaseAdminClient()
    const { count, error } = await admin
      .from('staff_users')
      .select('*', { count: 'exact', head: true })
    if (error) throw error
    return (count ?? 0) > 0
  },
)

export const bootstrapFirstStaffUser = createServerFn({ method: 'POST' })
  .validator(bootstrapAdminSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const admin = getSupabaseAdminClient()

    const { count, error: countError } = await admin
      .from('staff_users')
      .select('*', { count: 'exact', head: true })
    if (countError) throw countError
    if ((count ?? 0) > 0) {
      throw new Error('An admin account already exists — sign in instead.')
    }

    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email: data.email,
        password: data.password,
        email_confirm: true,
      })
    if (createError) throw createError

    const { error: staffError } = await admin.from('staff_users').insert({
      auth_user_id: created.user.id,
      full_name: data.fullName,
      role: 'super_admin',
    })
    if (staffError) throw staffError

    const { error: logError } = await admin.from('activity_logs').insert({
      actor_type: 'system',
      action: 'staff.bootstrap',
      entity_type: 'staff_users',
      entity_id: created.user.id,
      metadata: { email: data.email },
    })
    if (logError) throw logError

    return { ok: true }
  })

import { createServerFn } from '@tanstack/react-start'
import {
  changeStaffUserRoleSchema,
  createStaffUserSchema,
  resetStaffUserPasswordSchema,
  setStaffUserActiveSchema,
} from '#/lib/validation/admin/settings'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { logStaffActivity } from './activity-log'
import type { StaffRole, StaffUser } from '#/types/entities'

/** Only super admins manage other staff accounts. */
const MANAGE_STAFF_ROLES: StaffRole[] = ['super_admin']

export interface StaffAccount extends StaffUser {
  email: string
}

export const listStaffUsers = createServerFn({ method: 'GET' }).handler(
  async (): Promise<StaffAccount[]> => {
    await requireStaff(MANAGE_STAFF_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: staff, error } = await admin
      .from('staff_users')
      .select('*')
      .order('created_at', { ascending: true })
    if (error) throw error

    const withEmail = await Promise.all(
      staff.map(async (s) => {
        const { data, error: userError } = await admin.auth.admin.getUserById(
          s.auth_user_id,
        )
        if (userError) throw userError
        return { ...s, email: data.user.email ?? '(unknown)' }
      }),
    )
    return withEmail
  },
)

export const createStaffUser = createServerFn({ method: 'POST' })
  .validator(createStaffUserSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_STAFF_ROLES)
    const admin = getSupabaseAdminClient()

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
      role: data.role,
    })
    if (staffError) throw staffError

    await logStaffActivity(
      staff,
      'staff.create',
      'staff_users',
      created.user.id,
      {
        email: data.email,
        role: data.role,
      },
    )

    return { ok: true }
  })

/** Super admins can set a new password for any staff account directly — no reset-email flow, since a staff member locked out has no other way in and this is an internal tool, not customer-facing auth. */
export const resetStaffUserPassword = createServerFn({ method: 'POST' })
  .validator(resetStaffUserPasswordSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_STAFF_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: target, error: targetError } = await admin
      .from('staff_users')
      .select('auth_user_id')
      .eq('id', data.staffUserId)
      .single()
    if (targetError) throw targetError

    const { error } = await admin.auth.admin.updateUserById(
      target.auth_user_id,
      { password: data.newPassword },
    )
    if (error) throw error

    // Never log the new password itself — only that a reset happened.
    await logStaffActivity(
      staff,
      'staff.reset_password',
      'staff_users',
      data.staffUserId,
    )

    return { ok: true }
  })

export const setStaffUserActive = createServerFn({ method: 'POST' })
  .validator(setStaffUserActiveSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_STAFF_ROLES)
    if (data.staffUserId === staff.id && !data.isActive) {
      throw new Error("You can't deactivate your own account.")
    }
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('staff_users')
      .update({ is_active: data.isActive })
      .eq('id', data.staffUserId)
    if (error) throw error

    await logStaffActivity(
      staff,
      data.isActive ? 'staff.reactivate' : 'staff.deactivate',
      'staff_users',
      data.staffUserId,
    )

    return { ok: true }
  })

export const changeStaffUserRole = createServerFn({ method: 'POST' })
  .validator(changeStaffUserRoleSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_STAFF_ROLES)
    if (data.staffUserId === staff.id && data.role !== 'super_admin') {
      throw new Error(
        "You can't remove your own super admin role — have another super admin do it instead.",
      )
    }
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('staff_users')
      .update({ role: data.role })
      .eq('id', data.staffUserId)
    if (error) throw error

    await logStaffActivity(
      staff,
      'staff.change_role',
      'staff_users',
      data.staffUserId,
      { role: data.role },
    )

    return { ok: true }
  })

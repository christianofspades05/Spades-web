import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  codRestrictionInputSchema,
  setCodRestrictionActiveSchema,
  updateCodRestrictionSchema,
} from '#/lib/validation/admin/cod-restrictions'
import type { CodRestrictionInput } from '#/lib/validation/admin/cod-restrictions'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { logStaffActivity } from './activity-log'
import type { CodRestriction } from '#/types/entities'

const MANAGE_ROLES = ['super_admin', 'admin', 'manager'] as const

function toRow(data: CodRestrictionInput) {
  return {
    title: data.title,
    scope: data.scope,
    scope_ids: data.scopeIds,
    is_active: data.isActive,
  }
}

export const listCodRestrictions = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CodRestriction[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data, error } = await admin
      .from('cod_restrictions')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  },
)

export const getCodRestrictionById = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }): Promise<CodRestriction | null> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data: restriction, error } = await admin
      .from('cod_restrictions')
      .select('*')
      .eq('id', data.id)
      .maybeSingle()
    if (error) throw error
    return restriction
  })

export const createCodRestriction = createServerFn({ method: 'POST' })
  .validator(codRestrictionInputSchema)
  .handler(async ({ data }): Promise<CodRestriction> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: restriction, error } = await admin
      .from('cod_restrictions')
      .insert(toRow(data))
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(
      staff,
      'cod_restriction.create',
      'cod_restrictions',
      restriction.id,
      { title: data.title, scope: data.scope },
    )
    return restriction
  })

export const updateCodRestriction = createServerFn({ method: 'POST' })
  .validator(updateCodRestrictionSchema)
  .handler(async ({ data }): Promise<CodRestriction> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: restriction, error } = await admin
      .from('cod_restrictions')
      .update(toRow(data))
      .eq('id', data.id)
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(
      staff,
      'cod_restriction.update',
      'cod_restrictions',
      restriction.id,
      {},
    )
    return restriction
  })

export const setCodRestrictionActive = createServerFn({ method: 'POST' })
  .validator(setCodRestrictionActiveSchema)
  .handler(async ({ data }): Promise<void> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('cod_restrictions')
      .update({ is_active: data.isActive })
      .eq('id', data.id)
    if (error) throw error

    await logStaffActivity(
      staff,
      'cod_restriction.set_active',
      'cod_restrictions',
      data.id,
      { isActive: data.isActive },
    )
  })

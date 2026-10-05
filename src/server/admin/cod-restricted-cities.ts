/**
 * "Block COD by location" admin CRUD — see cod-restricted-cities table
 * (0094) and server/checkout/cod-city-restriction.ts for how checkout
 * actually enforces this.
 */
import { createServerFn } from '@tanstack/react-start'
import {
  codRestrictedCityInputSchema,
  deleteCodRestrictedCitySchema,
  setCodRestrictedCityActiveSchema,
} from '#/lib/validation/admin/cod-restricted-cities'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { logStaffActivity } from './activity-log'
import type { CodRestrictedCity } from '#/types/entities'

const MANAGE_ROLES = ['super_admin', 'admin', 'manager'] as const

export const listCodRestrictedCities = createServerFn({
  method: 'GET',
}).handler(async (): Promise<CodRestrictedCity[]> => {
  await requireStaff()
  const admin = getSupabaseAdminClient()
  const { data, error } = await admin
    .from('cod_restricted_cities')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
})

export const createCodRestrictedCity = createServerFn({ method: 'POST' })
  .validator(codRestrictedCityInputSchema)
  .handler(async ({ data }): Promise<CodRestrictedCity> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: row, error } = await admin
      .from('cod_restricted_cities')
      .insert({
        region: data.region,
        province: data.province,
        city: data.city,
        reason: data.reason ?? null,
      })
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(
      staff,
      'cod_restricted_city.create',
      'cod_restricted_cities',
      row.id,
      { city: data.city, province: data.province },
    )
    return row
  })

export const setCodRestrictedCityActive = createServerFn({ method: 'POST' })
  .validator(setCodRestrictedCityActiveSchema)
  .handler(async ({ data }): Promise<void> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('cod_restricted_cities')
      .update({ is_active: data.isActive })
      .eq('id', data.id)
    if (error) throw error

    await logStaffActivity(
      staff,
      'cod_restricted_city.set_active',
      'cod_restricted_cities',
      data.id,
      { isActive: data.isActive },
    )
  })

export const deleteCodRestrictedCity = createServerFn({ method: 'POST' })
  .validator(deleteCodRestrictedCitySchema)
  .handler(async ({ data }): Promise<void> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('cod_restricted_cities')
      .delete()
      .eq('id', data.id)
    if (error) throw error

    await logStaffActivity(
      staff,
      'cod_restricted_city.delete',
      'cod_restricted_cities',
      data.id,
      {},
    )
  })

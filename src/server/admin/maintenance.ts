import { createServerFn } from '@tanstack/react-start'
import { setMaintenanceModeSchema } from '#/lib/validation/admin/maintenance'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { logStaffActivity } from './activity-log'
import type { ProductBrand } from '#/types/database.types'
import type { StaffRole } from '#/types/entities'

// Not `as const` — requireStaff expects a plain mutable StaffRole[].
const MANAGE_ROLES: StaffRole[] = ['super_admin', 'admin', 'manager']

export interface MaintenanceModeRow {
  brand: ProductBrand
  is_active: boolean
}

export const listMaintenanceMode = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MaintenanceModeRow[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data, error } = await admin
      .from('storefront_maintenance_mode')
      .select('brand, is_active')
      .order('brand', { ascending: true })
    if (error) throw error
    return data
  },
)

export const setMaintenanceMode = createServerFn({ method: 'POST' })
  .validator(setMaintenanceModeSchema)
  .handler(async ({ data }): Promise<void> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('storefront_maintenance_mode')
      .update({
        is_active: data.isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('brand', data.brand)
    if (error) throw error

    await logStaffActivity(
      staff,
      'storefront.maintenance_mode_update',
      'storefront_maintenance_mode',
      data.brand,
      { isActive: data.isActive },
    )
  })

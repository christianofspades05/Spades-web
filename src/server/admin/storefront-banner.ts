import { createServerFn } from '@tanstack/react-start'
import { setStorefrontBannerSchema } from '#/lib/validation/admin/storefront-banner'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { logStaffActivity } from './activity-log'
import type { ProductBrand } from '#/types/database.types'
import type { StaffRole } from '#/types/entities'

// Not `as const` — requireStaff expects a plain mutable StaffRole[].
const MANAGE_ROLES: StaffRole[] = ['super_admin', 'admin', 'manager']

export interface StorefrontBannerRow {
  brand: ProductBrand
  text: string
  text_ja: string | null
  text_ko: string | null
  is_active: boolean
}

export const listStorefrontBanners = createServerFn({ method: 'GET' }).handler(
  async (): Promise<StorefrontBannerRow[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data, error } = await admin
      .from('storefront_banner')
      .select('brand, text, text_ja, text_ko, is_active')
      .order('brand', { ascending: true })
    if (error) throw error
    return data
  },
)

export const setStorefrontBanner = createServerFn({ method: 'POST' })
  .validator(setStorefrontBannerSchema)
  .handler(async ({ data }): Promise<void> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('storefront_banner')
      .update({
        text: data.text,
        text_ja: data.textJa ?? null,
        text_ko: data.textKo ?? null,
        is_active: data.isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('brand', data.brand)
    if (error) throw error

    await logStaffActivity(
      staff,
      'storefront.banner_update',
      'storefront_banner',
      data.brand,
      { text: data.text, isActive: data.isActive },
    )
  })

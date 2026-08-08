import { createServerFn } from '@tanstack/react-start'
import {
  createStorefrontBannerSchema,
  deleteStorefrontBannerSchema,
  setStorefrontBannerSchema,
} from '#/lib/validation/admin/storefront-banner'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { logStaffActivity } from './activity-log'
import type { ProductBrand } from '#/types/database.types'
import type { StaffRole } from '#/types/entities'

// Not `as const` — requireStaff expects a plain mutable StaffRole[].
const MANAGE_ROLES: StaffRole[] = ['super_admin', 'admin', 'manager']

export interface StorefrontBannerRow {
  id: string
  brand: ProductBrand
  text: string
  text_ja: string | null
  text_ko: string | null
  is_active: boolean
  sort_order: number
}

export const listStorefrontBanners = createServerFn({ method: 'GET' }).handler(
  async (): Promise<StorefrontBannerRow[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data, error } = await admin
      .from('storefront_banner')
      .select('id, brand, text, text_ja, text_ko, is_active, sort_order')
      .order('brand', { ascending: true })
      .order('sort_order', { ascending: true })
    if (error) throw error
    return data
  },
)

export const createStorefrontBanner = createServerFn({ method: 'POST' })
  .validator(createStorefrontBannerSchema)
  .handler(async ({ data }): Promise<StorefrontBannerRow> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    // Next slot in this brand's rotation — starts a fresh banner at the end
    // of the sequence rather than needing staff to set an order by hand.
    const { data: existing, error: existingError } = await admin
      .from('storefront_banner')
      .select('sort_order')
      .eq('brand', data.brand)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existingError) throw existingError
    const nextSortOrder = (existing?.sort_order ?? -1) + 1

    const { data: row, error } = await admin
      .from('storefront_banner')
      .insert({
        brand: data.brand,
        text: '',
        is_active: true,
        sort_order: nextSortOrder,
      })
      .select('id, brand, text, text_ja, text_ko, is_active, sort_order')
      .single()
    if (error) throw error

    await logStaffActivity(
      staff,
      'storefront.banner_create',
      'storefront_banner',
      row.id,
      { brand: data.brand },
    )
    return row
  })

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
      .eq('id', data.id)
    if (error) throw error

    await logStaffActivity(
      staff,
      'storefront.banner_update',
      'storefront_banner',
      data.id,
      { text: data.text, isActive: data.isActive },
    )
  })

export const deleteStorefrontBanner = createServerFn({ method: 'POST' })
  .validator(deleteStorefrontBannerSchema)
  .handler(async ({ data }): Promise<void> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('storefront_banner')
      .delete()
      .eq('id', data.id)
    if (error) throw error

    await logStaffActivity(
      staff,
      'storefront.banner_delete',
      'storefront_banner',
      data.id,
      {},
    )
  })

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSupabaseServerClient } from '#/lib/supabase/server'
import { STOREFRONT_BRANDS } from '#/lib/validation/admin/storefront-sections'

export interface StorefrontBanner {
  text: string
  isActive: boolean
}

/**
 * `brand`'s top promo banner — checked on every page load from
 * routes/__root.tsx (see beforeLoad), same pattern as getMaintenanceMode.
 * Public/anon read — there's nothing sensitive in a promo banner.
 */
export const getStorefrontBanner = createServerFn({ method: 'GET' })
  .validator(z.object({ brand: z.enum(STOREFRONT_BRANDS) }))
  .handler(async ({ data }): Promise<StorefrontBanner> => {
    const supabase = getSupabaseServerClient()
    const { data: row, error } = await supabase
      .from('storefront_banner')
      .select('text, is_active')
      .eq('brand', data.brand)
      .maybeSingle()
    if (error) throw error
    return { text: row?.text ?? '', isActive: row?.is_active ?? false }
  })

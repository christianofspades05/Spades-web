import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSupabaseServerClient } from '#/lib/supabase/server'
import { STOREFRONT_BRANDS } from '#/lib/validation/admin/storefront-sections'

/**
 * Whether `brand`'s storefront should currently show the maintenance page
 * instead of its normal site — checked on every page load from
 * routes/__root.tsx (see beforeLoad). Public/anon read, same as
 * exchange_rates — there's nothing sensitive in a maintenance flag.
 */
export const getMaintenanceMode = createServerFn({ method: 'GET' })
  .validator(z.object({ brand: z.enum(STOREFRONT_BRANDS) }))
  .handler(async ({ data }): Promise<boolean> => {
    const supabase = getSupabaseServerClient()
    const { data: row, error } = await supabase
      .from('storefront_maintenance_mode')
      .select('is_active')
      .eq('brand', data.brand)
      .maybeSingle()
    if (error) throw error
    return row?.is_active ?? false
  })

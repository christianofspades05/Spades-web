import { z } from 'zod'
import { STOREFRONT_BRANDS } from '#/lib/validation/admin/storefront-sections'

export const setMaintenanceModeSchema = z.object({
  brand: z.enum(STOREFRONT_BRANDS),
  isActive: z.boolean(),
})

export type SetMaintenanceModeInput = z.infer<typeof setMaintenanceModeSchema>

import { z } from 'zod'
import { STOREFRONT_BRANDS } from '#/lib/validation/admin/storefront-sections'

export const setStorefrontBannerSchema = z.object({
  brand: z.enum(STOREFRONT_BRANDS),
  text: z.string().trim().max(300),
  textJa: z.string().trim().max(300).optional(),
  textKo: z.string().trim().max(300).optional(),
  isActive: z.boolean(),
})

export type SetStorefrontBannerInput = z.infer<typeof setStorefrontBannerSchema>

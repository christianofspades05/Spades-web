import { z } from 'zod'
import { STOREFRONT_BRANDS } from '#/lib/validation/admin/storefront-sections'

export const setStorefrontBannerSchema = z.object({
  id: z.string().uuid(),
  text: z.string().trim().max(300),
  textJa: z.string().trim().max(300).optional(),
  textKo: z.string().trim().max(300).optional(),
  isActive: z.boolean(),
})

export const createStorefrontBannerSchema = z.object({
  brand: z.enum(STOREFRONT_BRANDS),
})

export const deleteStorefrontBannerSchema = z.object({
  id: z.string().uuid(),
})

export type SetStorefrontBannerInput = z.infer<typeof setStorefrontBannerSchema>
export type CreateStorefrontBannerInput = z.infer<
  typeof createStorefrontBannerSchema
>
export type DeleteStorefrontBannerInput = z.infer<
  typeof deleteStorefrontBannerSchema
>

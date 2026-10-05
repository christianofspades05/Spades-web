import { z } from 'zod'

export const codRestrictedCityInputSchema = z.object({
  region: z.string().trim().min(1).max(120),
  province: z.string().trim().min(1).max(120),
  city: z.string().trim().min(1).max(120),
  reason: z.string().trim().max(500).optional(),
})

export const deleteCodRestrictedCitySchema = z.object({
  id: z.string().uuid(),
})

export const setCodRestrictedCityActiveSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
})

export type CodRestrictedCityInput = z.infer<
  typeof codRestrictedCityInputSchema
>

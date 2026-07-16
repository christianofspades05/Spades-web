import { z } from 'zod'

export const codRestrictionInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  scope: z.enum(['collection', 'product']),
  scopeIds: z
    .array(z.string().uuid())
    .min(1, 'Select at least one collection or product'),
  isActive: z.boolean().default(true),
})

export const updateCodRestrictionSchema = codRestrictionInputSchema.and(
  z.object({ id: z.string().uuid() }),
)

export const setCodRestrictionActiveSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
})

export type CodRestrictionInput = z.infer<typeof codRestrictionInputSchema>
export type UpdateCodRestrictionInput = z.infer<
  typeof updateCodRestrictionSchema
>

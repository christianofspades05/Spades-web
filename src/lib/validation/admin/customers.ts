import { z } from 'zod'

export const customerRiskUpdateSchema = z.object({
  id: z.string().uuid(),
  isHighRisk: z.boolean(),
  codBlocked: z.boolean(),
  riskNotes: z.string().trim().max(2000).optional(),
})

export type CustomerRiskUpdateInput = z.infer<typeof customerRiskUpdateSchema>

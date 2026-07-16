import { z } from 'zod'

export const submitStoreFeedbackSchema = z.object({
  name: z.string().trim().max(200).optional(),
  email: z.string().trim().email(),
  phone: z.string().trim().max(50).optional(),
  comment: z.string().trim().max(5000).optional(),
})

export type SubmitStoreFeedbackInput = z.infer<typeof submitStoreFeedbackSchema>

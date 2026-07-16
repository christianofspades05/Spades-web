import { z } from 'zod'

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const

export const setReviewStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(REVIEW_STATUSES),
})

export type SetReviewStatusInput = z.infer<typeof setReviewStatusSchema>

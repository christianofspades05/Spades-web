import { z } from 'zod'

export const reviewTokenSchema = z.object({
  token: z.string().min(1),
})

export const uploadReviewPhotoSchema = z.object({
  token: z.string().min(1),
  base64Data: z.string().min(1),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
})

export const reviewSubmissionItemSchema = z.object({
  productId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  reviewText: z.string().trim().max(5000).optional(),
  photoUrls: z.array(z.string().url()).max(5).default([]),
})

export const submitReviewsSchema = z.object({
  token: z.string().min(1),
  reviews: z.array(reviewSubmissionItemSchema).min(1),
})

export type ReviewSubmissionItem = z.infer<typeof reviewSubmissionItemSchema>
export type SubmitReviewsInput = z.infer<typeof submitReviewsSchema>

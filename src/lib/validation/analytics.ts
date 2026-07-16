import { z } from 'zod'

export const EVENT_TYPES = ['page_view', 'checkout_start'] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const recordVisitSchema = z.object({
  visitorId: z.string().uuid(),
  path: z.string().trim().min(1).max(500),
  eventType: z.enum(EVENT_TYPES).default('page_view'),
  productId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
})

export type RecordVisitInput = z.infer<typeof recordVisitSchema>

import { z } from 'zod'

export const EVENT_TYPES = ['page_view', 'checkout_start'] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const recordVisitSchema = z.object({
  visitorId: z.string().uuid(),
  path: z.string().trim().min(1).max(500),
  eventType: z.enum(EVENT_TYPES).default('page_view'),
  productId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  // Which brand's domain this visit happened on (see
  // server/storefront/domain.ts) — plain string, not that module's Brand
  // enum, to keep this validation module free of a server/ dependency.
  brand: z.string().default('spades'),
})

export type RecordVisitInput = z.infer<typeof recordVisitSchema>

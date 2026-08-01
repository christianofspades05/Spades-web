import { z } from 'zod'

export const marketInputSchema = z.object({
  // A market always covers at least one country — grouping Japan + South
  // Korea under one 90% market (rather than two separate identical entries)
  // is the whole point of this shape.
  countryCodes: z
    .array(z.string().trim().length(2).toUpperCase())
    .min(1, 'Select at least one country'),
  // e.g. 15 means +15% on the product subtotal — never applied to shipping,
  // see lib/checkout/market-pricing.ts.
  markupPercent: z.number().min(0).max(500),
  isActive: z.boolean().default(true),
})

export const updateMarketSchema = marketInputSchema.and(
  z.object({ id: z.string().uuid() }),
)

export type MarketInput = z.infer<typeof marketInputSchema>
export type UpdateMarketInput = z.infer<typeof updateMarketSchema>

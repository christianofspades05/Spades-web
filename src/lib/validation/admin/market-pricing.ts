import { z } from 'zod'

export const marketPricingInputSchema = z.object({
  countryCode: z.string().trim().length(2).toUpperCase(),
  // e.g. 15 means +15% on the product subtotal — never applied to shipping,
  // see lib/checkout/market-pricing.ts.
  markupPercent: z.number().min(0).max(500),
  isActive: z.boolean().default(true),
})

export const updateMarketPricingSchema = marketPricingInputSchema.and(
  z.object({ id: z.string().uuid() }),
)

export const setMarketPricingActiveSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
})

export type MarketPricingInput = z.infer<typeof marketPricingInputSchema>
export type UpdateMarketPricingInput = z.infer<typeof updateMarketPricingSchema>

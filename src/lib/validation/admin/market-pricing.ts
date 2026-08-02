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
  // All shipping fields below are optional — a market with none set keeps
  // using the existing flat international shipping fee (see
  // lib/checkout/shipping.ts). Entered in PHP directly, same as every other
  // price in this app (online payments only settle in PHP for now).
  shippingName: z.string().trim().min(1).max(100).optional(),
  shippingPriceCents: z.number().int().min(0).optional(),
  // At most one of these is ever set by the admin form (a single free-
  // shipping trigger: spend X, or buy N+ items) — both nullable/optional
  // since a market isn't required to offer free shipping at all.
  freeShippingMinSubtotalCents: z.number().int().min(0).optional(),
  freeShippingMinItems: z.number().int().min(1).optional(),
})

export const updateMarketSchema = marketInputSchema.and(
  z.object({ id: z.string().uuid() }),
)

export type MarketInput = z.infer<typeof marketInputSchema>
export type UpdateMarketInput = z.infer<typeof updateMarketSchema>

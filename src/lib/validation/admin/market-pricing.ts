import { z } from 'zod'
import { SUPPORTED_CURRENCIES } from '#/lib/utils/money'

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
  // lib/checkout/shipping.ts). shippingPriceCents is denominated in
  // shippingCurrency (e.g. SGD for a Singapore market), converted to PHP
  // live at checkout using the same exchange_rates table the storefront
  // currency selector already uses — never assumed to already be PHP.
  shippingName: z.string().trim().min(1).max(100).optional(),
  shippingPriceCents: z.number().int().min(0).optional(),
  shippingCurrency: z.enum(SUPPORTED_CURRENCIES).default('PHP'),
  // At most one of these is ever set by the admin form (a single free-
  // shipping trigger: spend X, or buy N+ items) — both nullable/optional
  // since a market isn't required to offer free shipping at all. The
  // minimum-subtotal trigger is compared against the order's PHP subtotal
  // regardless of shippingCurrency, so it's always entered in PHP.
  freeShippingMinSubtotalCents: z.number().int().min(0).optional(),
  freeShippingMinItems: z.number().int().min(1).optional(),
})

export const updateMarketSchema = marketInputSchema.and(
  z.object({ id: z.string().uuid() }),
)

export type MarketInput = z.infer<typeof marketInputSchema>
export type UpdateMarketInput = z.infer<typeof updateMarketSchema>

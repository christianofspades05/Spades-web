import { z } from 'zod'

export const discountInputSchema = z
  .object({
    kind: z.enum(['code', 'automatic']),
    // 'all' (a store-wide sale, optionally excluding some collections) or
    // 'collection' (a sale scoped to only the included collections) — only
    // meaningful when kind is 'automatic'; a discount code is always
    // store-wide (scope is forced to 'all' server-side for those).
    scope: z.enum(['all', 'collection']).default('all'),
    title: z.string().trim().min(1).max(200),
    code: z.string().trim().min(3).max(50).optional(),
    discountType: z.enum(['percentage', 'fixed_amount']),
    percentageValue: z.number().min(1).max(100).optional(),
    amountPesos: z.number().min(0).optional(),
    startsAt: z.string().optional(),
    endsAt: z.string().optional(),
    maxUses: z.number().int().min(1).optional(),
    oneUsePerCustomer: z.boolean().default(false),
    // Caps the discount to only the N highest-priced units in an eligible
    // cart — e.g. a 50%-off code with maxDiscountedItems: 3 only discounts
    // the customer's 3 priciest qualifying units, full price on the rest.
    // Unset (the default) discounts every eligible unit, as today.
    maxDiscountedItems: z.number().int().min(1).optional(),
    // When true, applying this code always charges the normal shipping fee
    // — the site-wide/market free-shipping threshold never waives it,
    // regardless of the post-discount subtotal. Meant for gift-style codes
    // (e.g. a birthday discount) that shouldn't stack with free shipping.
    excludesFreeShipping: z.boolean().default(false),
    // Only meaningful for kind 'automatic' — never a code. On a Store sale
    // (scope 'all'), lets discount codes stack on top of it instead of
    // always being replaced by whichever code the customer applies. On a
    // Collection sale (scope 'collection'), lets it stack on top of an
    // active store-wide sale instead of standing alone at its own rate
    // (e.g. Clearance) — a different axis from the Store sale meaning,
    // sharing the same field since only one applies per discount's scope.
    stacksWithSale: z.boolean().default(false),
    isActive: z.boolean().default(true),
    excludedCollectionIds: z.array(z.string().uuid()).default([]),
    includedCollectionIds: z.array(z.string().uuid()).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.kind === 'code' && !data.code) {
      ctx.addIssue({
        code: 'custom',
        message: 'A code is required for discount codes',
        path: ['code'],
      })
    }
    if (data.discountType === 'percentage' && !data.percentageValue) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a percentage',
        path: ['percentageValue'],
      })
    }
    if (
      data.discountType === 'fixed_amount' &&
      data.amountPesos === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter an amount',
        path: ['amountPesos'],
      })
    }
    if (
      data.kind === 'automatic' &&
      data.scope === 'collection' &&
      data.includedCollectionIds.length === 0
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick at least one collection for a collection sale',
        path: ['includedCollectionIds'],
      })
    }
  })

export const updateDiscountSchema = discountInputSchema.and(
  z.object({ id: z.string().uuid() }),
)

export const setDiscountActiveSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
})

export type DiscountInput = z.infer<typeof discountInputSchema>
export type UpdateDiscountInput = z.infer<typeof updateDiscountSchema>

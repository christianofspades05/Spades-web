import { z } from 'zod'

export const discountInputSchema = z
  .object({
    kind: z.enum(['code', 'automatic']),
    title: z.string().trim().min(1).max(200),
    code: z.string().trim().min(3).max(50).optional(),
    discountType: z.enum(['percentage', 'fixed_amount']),
    percentageValue: z.number().min(1).max(100).optional(),
    amountPesos: z.number().min(0).optional(),
    startsAt: z.string().optional(),
    endsAt: z.string().optional(),
    maxUses: z.number().int().min(1).optional(),
    oneUsePerCustomer: z.boolean().default(false),
    isActive: z.boolean().default(true),
    excludedCollectionIds: z.array(z.string().uuid()).default([]),
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

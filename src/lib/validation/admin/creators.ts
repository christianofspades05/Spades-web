import { z } from 'zod'

const id = z.string().uuid()
const cents = z.number().int().min(0).max(2_000_000_000)
const reference = z.string().trim().min(1).max(200)
const socialUrl = z.union([
  z.literal(''),
  z.url().refine((s) => /^https?:\/\//.test(s), 'Use an HTTP or HTTPS URL'),
])
export const creatorCommandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save_creator'),
    creatorId: id.optional(),
    name: z.string().trim().min(1).max(200),
    email: z.union([z.literal(''), z.email()]),
    tiktokUrl: socialUrl,
    instagramUrl: socialUrl,
    facebookUrl: socialUrl,
    notes: z.string().max(4000),
    isActive: z.boolean(),
  }),
  z.object({
    action: z.literal('assign_code'),
    creatorId: id,
    discountId: id,
    commissionBps: z.number().int().min(0).max(10000),
    holdDays: z.number().int().min(0).max(365).default(14),
    brand: z.enum(['spades', 'ysrael', 'aspire365']),
    isActive: z.boolean(),
  }),
  z.object({ action: z.literal('reconcile'), creatorId: id }),
  z.object({ action: z.literal('approve'), orderId: id }),
  z.object({
    action: z.literal('payout'),
    creatorId: id,
    reference,
    expectedAmountCents: cents.positive(),
  }),
  z
    .object({
      action: z.literal('expense'),
      id,
      creatorId: id,
      kind: z.enum(['content_fee', 'gift', 'other']),
      description: z.string().trim().min(1).max(1000),
      amountCents: cents,
      variantId: id.optional(),
      quantity: z.number().int().min(1).max(10000).optional(),
      incurredAt: z.iso.datetime(),
      paidAt: z.iso.datetime().nullable(),
    })
    .refine(
      (d) => d.kind !== 'gift' || Boolean(d.variantId && d.quantity),
      'Choose a variant and quantity for a gift',
    ),
  z.object({ action: z.literal('expense_paid'), creatorId: id, expenseId: id }),
  z.object({
    action: z.literal('request_return'),
    orderId: id,
    orderItemId: id,
    quantity: z.number().int().min(1).max(10000),
    reason: z.string().trim().min(1).max(1000),
  }),
  z.object({ action: z.literal('resolve_return'), returnId: id }),
  z.object({ action: z.literal('collect_cod'), orderId: id, reference }),
  z
    .object({
      action: z.literal('record_refund'),
      source: z.enum(['manual', 'paypal', 'xendit']).default('manual'),
      orderId: id,
      reference,
      amountCents: cents.positive(),
      shippingCents: cents,
      taxCents: cents,
      occurredAt: z.iso.datetime(),
      items: z
        .array(
          z.object({
            orderItemId: id,
            returnId: id.optional(),
            amountCents: cents.positive(),
          }),
        )
        .max(100),
    })
    .refine(
      (d) =>
        d.items.reduce(
          (s, i) => s + i.amountCents,
          d.shippingCents + d.taxCents,
        ) === d.amountCents,
      'Item, shipping and tax amounts must equal the refund total',
    ),
  z.object({
    action: z.literal('receive_return'),
    returnId: id,
    orderItemId: id,
    restock: z.boolean(),
  }),
])
export type CreatorCommand = z.infer<typeof creatorCommandSchema>

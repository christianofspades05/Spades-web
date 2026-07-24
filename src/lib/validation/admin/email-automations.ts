import { z } from 'zod'

export const EMAIL_BLOCK_TYPES = [
  'header_image',
  'heading',
  'text',
  'button',
  'discount_code',
  'cart_items',
  'order_items',
  'footer',
] as const

export const EMAIL_BLOCK_TYPE_LABELS: Record<
  (typeof EMAIL_BLOCK_TYPES)[number],
  string
> = {
  header_image: 'Header image',
  heading: 'Heading',
  text: 'Text',
  button: 'Button',
  discount_code: 'Discount code',
  cart_items: 'Cart items (dynamic)',
  order_items: 'Order items (dynamic)',
  footer: 'Footer',
}

export const emailBlockSchema = z
  .object({
    type: z.enum(EMAIL_BLOCK_TYPES),
    imageUrl: z.string().trim().max(2000).optional(),
    text: z.string().trim().max(5000).optional(),
    buttonLabel: z.string().trim().max(100).optional(),
    buttonUrl: z.string().trim().max(2000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'header_image' && !data.imageUrl) {
      ctx.addIssue({
        code: 'custom',
        message: 'Upload an image',
        path: ['imageUrl'],
      })
    }
    if ((data.type === 'heading' || data.type === 'text') && !data.text) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter text',
        path: ['text'],
      })
    }
    if (data.type === 'button' && (!data.buttonLabel || !data.buttonUrl)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a button label and URL',
        path: ['buttonLabel'],
      })
    }
  })

export const updateEmailAutomationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  isActive: z.boolean(),
  subject: z.string().trim().max(200),
  blocks: z.array(emailBlockSchema).max(20),
  discountId: z.string().uuid().nullable(),
  // Bounded to 2 years — anything longer almost certainly means a mistaken
  // days/hours mix-up when typing the schedule in, not a real intent.
  // Fractional (e.g. 0.5 = 30 min) is allowed for fast steps in a sequence.
  delayHours: z
    .number()
    .min(0)
    .max(24 * 365 * 2),
})

export type EmailBlockInput = z.infer<typeof emailBlockSchema>
export type UpdateEmailAutomationInput = z.infer<
  typeof updateEmailAutomationSchema
>

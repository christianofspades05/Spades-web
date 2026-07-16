import { z } from 'zod'
import { philippineAddressSchema } from './address'

export const checkoutContactSchema = philippineAddressSchema
  .omit({ label: true, isDefaultShipping: true, isDefaultBilling: true })
  .extend({
    email: z.string().trim().email(),
  })

export type CheckoutContactInput = z.infer<typeof checkoutContactSchema>

/**
 * 'cod' places the order directly. 'online' also places the order (stock is
 * reserved immediately either way) but returns a Xendit invoice URL to
 * redirect the customer to instead of a confirmation page — see
 * src/server/checkout/place-order.ts.
 */
export const placeOrderSchema = z.object({
  contact: checkoutContactSchema,
  paymentProvider: z.enum(['cod', 'online']),
})

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>

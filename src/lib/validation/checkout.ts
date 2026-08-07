import { z } from 'zod'
import { SUPPORTED_CURRENCIES } from '#/lib/utils/money'

/**
 * Checkout's own address schema — deliberately separate from
 * lib/validation/address.ts's philippineAddressSchema (used by the account
 * address book, which stays PH-only). Checkout ships anywhere: a 'PH'
 * destination uses the existing region/province/city/barangay cascading
 * fields and a PH mobile number; any other country uses general
 * city/province/postal-code fields and a more permissive phone format —
 * enforced below via superRefine since which fields are required depends
 * on `country`.
 */
export const checkoutContactBaseSchema = z.object({
  email: z.string().trim().email(),
  recipientName: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(1).max(30),
  country: z.string().trim().length(2).default('PH'),
  region: z.string().trim().max(120).optional(),
  province: z.string().trim().min(1).max(120),
  city: z.string().trim().min(1).max(120),
  barangay: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().min(1).max(12),
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200).optional(),
  landmark: z.string().trim().max(200).optional(),
  // 'lalamove' only ever applies to Spades/Metro-Manila/12-4pm (see
  // lib/checkout/lalamove-eligibility.ts) — its fee is never charged
  // through this site, just collected in cash by the rider on delivery, so
  // there's no cents field here to validate.
  shippingMethod: z.enum(['standard', 'lalamove']).default('standard'),
  // Nullable, not just optional — CheckoutInfo (see
  // lib/checkout/CheckoutContext.tsx) uses null for "no pin yet".
  lalamoveDropoffLat: z.number().nullable().optional(),
  lalamoveDropoffLng: z.number().nullable().optional(),
  lalamoveDropoffAddress: z.string().trim().max(300).optional(),
})

export const checkoutContactSchema = checkoutContactBaseSchema.superRefine(
  (data, ctx) => {
    if (data.country !== 'PH') return
    if (!/^(\+63|0)9\d{9}$/.test(data.phone)) {
      ctx.addIssue({
        code: 'custom',
        path: ['phone'],
        message: 'Enter a valid PH mobile number, e.g. 09171234567',
      })
    }
    if (!data.region) {
      ctx.addIssue({
        code: 'custom',
        path: ['region'],
        message: 'Region is required',
      })
    }
    if (!data.barangay) {
      ctx.addIssue({
        code: 'custom',
        path: ['barangay'],
        message: 'Barangay is required',
      })
    }
    if (
      data.shippingMethod === 'lalamove' &&
      (data.lalamoveDropoffLat == null ||
        data.lalamoveDropoffLng == null ||
        !data.lalamoveDropoffAddress)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['lalamoveDropoffLat'],
        message: 'Drop a pin for your Lalamove delivery location',
      })
    }
  },
)

export type CheckoutContactInput = z.infer<typeof checkoutContactBaseSchema>

/**
 * 'cod' places the order directly. 'online' also places the order (stock is
 * reserved immediately either way) but returns a Xendit invoice URL to
 * redirect the customer to instead of a confirmation page — see
 * src/server/checkout/place-order.ts.
 *
 * currency is the customer's selected display currency (see
 * lib/currency/CurrencyContext.tsx) — place-order.ts only honors it for the
 * 'online' path (COD always charges PHP) and re-derives the actual charge
 * amount server-side from the exchange_rates table, never trusting a
 * client-computed amount.
 */
export const placeOrderSchema = z.object({
  contact: checkoutContactSchema,
  paymentProvider: z.enum(['cod', 'online']),
  currency: z.enum(SUPPORTED_CURRENCIES).default('PHP'),
})

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>

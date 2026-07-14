import { z } from 'zod'

/**
 * Philippine shipping/billing address input validation. Used server-side by
 * any server function that accepts an address (account address book now;
 * checkout later) — never trust address data without running it through
 * this first.
 */
export const philippineAddressSchema = z.object({
  label: z.string().trim().max(50).optional(),
  recipientName: z.string().trim().min(1).max(120),
  phone: z
    .string()
    .trim()
    .regex(/^(\+63|0)9\d{9}$/, 'Enter a valid PH mobile number, e.g. 09171234567'),
  region: z.string().trim().min(1).max(120),
  province: z.string().trim().min(1).max(120),
  city: z.string().trim().min(1).max(120),
  barangay: z.string().trim().min(1).max(120),
  postalCode: z.string().trim().max(10).optional(),
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200).optional(),
  landmark: z.string().trim().max(200).optional(),
  isDefaultShipping: z.boolean().optional(),
  isDefaultBilling: z.boolean().optional(),
})

export type PhilippineAddressInput = z.infer<typeof philippineAddressSchema>

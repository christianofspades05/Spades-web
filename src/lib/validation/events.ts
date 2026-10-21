import { z } from 'zod'

/** Staff-side create/update form for a community event — admin/community. */
export const eventInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  locationName: z.string().trim().min(1).max(200),
  locationMapUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
  imageUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
  startsAt: z.string().trim().min(1),
  totalSlots: z.number().int().min(1).max(100000),
  feePesos: z.number().min(0),
  isActive: z.boolean().default(true),
})
export type EventInput = z.infer<typeof eventInputSchema>

export const updateEventSchema = eventInputSchema.extend({
  id: z.string().uuid(),
})

/** Guest registration — no account required, just enough to reserve a
 *  slot and receive a confirmation/receipt email. Age is a plain integer
 *  (not a date of birth) since the only thing an event organizer needs is
 *  "how old are they," not a verifiable birth date. */
export const registerForEventSchema = z.object({
  eventId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(120),
  age: z.number().int().min(0).max(130),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(30).optional(),
})
export type RegisterForEventInput = z.infer<typeof registerForEventSchema>

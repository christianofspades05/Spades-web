import { z } from 'zod'

export const STAFF_ROLES = [
  'super_admin',
  'admin',
  'manager',
  'packer',
  'support',
] as const

export const createStaffUserSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
  fullName: z.string().trim().min(1).max(120),
  role: z.enum(STAFF_ROLES),
})

export const setStaffUserActiveSchema = z.object({
  staffUserId: z.string().uuid(),
  isActive: z.boolean(),
})

export type CreateStaffUserInput = z.infer<typeof createStaffUserSchema>
export type SetStaffUserActiveInput = z.infer<typeof setStaffUserActiveSchema>

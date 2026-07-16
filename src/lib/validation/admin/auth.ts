import { z } from 'zod'

export const signInSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
})

export const bootstrapAdminSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
  fullName: z.string().trim().min(1).max(120),
})

export type SignInInput = z.infer<typeof signInSchema>
export type BootstrapAdminInput = z.infer<typeof bootstrapAdminSchema>

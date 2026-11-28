import { z } from 'zod'

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
/** `<input type="datetime-local">` value, read as Manila time. */
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
const timeOfDay = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/)

export const teamAttendanceSchema = z.object({
  from: dateKey,
  to: dateKey,
  employeeId: z.string().uuid().optional(),
  flaggedOnly: z.boolean().default(false),
})

export const saveAttendanceEntrySchema = z.object({
  id: z.string().uuid().optional(),
  employeeId: z.string().uuid(),
  clockIn: localDateTime,
  clockOut: localDateTime.nullable(),
  breakMinutes: z.number().int().min(0).max(600).nullable(),
  note: z.string().trim().min(1, 'A note is required for every edit').max(500),
})

export const deleteAttendanceEntrySchema = z.object({
  id: z.string().uuid(),
  note: z.string().trim().min(1, 'A note is required').max(500),
})

export const saveEmployeeSchema = z.object({
  id: z.string().uuid().optional(),
  fullName: z.string().trim().min(1).max(120),
  staffUserId: z.string().uuid().nullable(),
  isActive: z.boolean(),
})

export const savePayProfileSchema = z
  .object({
    employeeId: z.string().uuid(),
    payType: z.enum(['hourly', 'monthly']),
    hourlyRateCents: z.number().int().min(0).nullable(),
    monthlySalaryCents: z.number().int().min(0).nullable(),
    workDaysPerWeek: z.union([z.literal(5), z.literal(6)]),
    restDays: z.array(z.number().int().min(0).max(6)).max(6),
    scheduledStart: timeOfDay.nullable(),
    scheduledHoursPerDay: z.number().positive().max(16),
    unpaidBreakMinutes: z.number().int().min(0).max(240),
    lateGraceMinutes: z.number().int().min(0).max(120),
    deductLates: z.boolean(),
    overtimeEnabled: z.boolean(),
    overtimeMultiplier: z.number().positive().max(5),
    effectiveFrom: dateKey,
  })
  .refine((v) => v.payType !== 'hourly' || v.hourlyRateCents !== null, {
    message: 'Hourly rate is required',
  })
  .refine((v) => v.payType !== 'monthly' || v.monthlySalaryCents !== null, {
    message: 'Monthly salary is required',
  })

export const saveDayMarkSchema = z.object({
  employeeId: z.string().uuid().nullable(),
  markDate: dateKey,
  kind: z.enum(['holiday', 'leave']),
  note: z.string().trim().max(200).nullable(),
})

export const periodIdSchema = z.object({ periodId: z.string().uuid() })

export const getPayrollSchema = z.object({
  periodId: z.string().uuid().optional(),
})

export const adjustmentSchema = z.object({
  label: z.string().trim().min(1).max(80),
  amount_cents: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Amount cannot be 0'),
})

export const updatePayrollItemSchema = z.object({
  itemId: z.string().uuid(),
  adjustments: z.array(adjustmentSchema).max(20),
  notes: z.string().trim().max(500).nullable(),
})

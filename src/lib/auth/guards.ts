/**
 * Server-only guard helpers. Call these at the top of a server function or
 * route loader to enforce auth before touching the admin client.
 */
import { getCurrentCustomer, getCurrentStaffUser } from './session'
import type { Customer, StaffRole, StaffUser } from '#/types/entities'

export class UnauthorizedError extends Error {
  constructor(message = 'Not authenticated') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Not allowed') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export async function requireCustomer(): Promise<Customer> {
  const customer = await getCurrentCustomer()
  if (!customer) throw new UnauthorizedError('Sign in required')
  return customer
}

export async function requireStaff(
  allowedRoles?: Array<StaffRole>,
): Promise<StaffUser> {
  const staff = await getCurrentStaffUser()
  if (!staff) throw new UnauthorizedError('Staff sign in required')
  if (allowedRoles && !allowedRoles.includes(staff.role)) {
    throw new ForbiddenError(
      `Requires one of roles: ${allowedRoles.join(', ')}`,
    )
  }
  return staff
}

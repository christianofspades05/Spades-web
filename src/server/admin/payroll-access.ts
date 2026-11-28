import { ForbiddenError, requireStaff } from '#/lib/auth/guards'
import type { StaffUser } from '#/types/entities'

/** Payroll, pay rates and everyone's attendance are visible only to staff
 *  rows with can_manage_payroll (the store owner) — not to a role, since
 *  several accounts share super_admin. */
export async function requirePayrollOwner(): Promise<StaffUser> {
  const staff = await requireStaff()
  if (!staff.can_manage_payroll) {
    throw new ForbiddenError('Only the owner can view payroll')
  }
  return staff
}

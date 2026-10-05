/**
 * A customer with a proven delivery track record can still use Cash on
 * Delivery in an otherwise COD-restricted city (see cod-city-restriction.ts)
 * — the city gets blocked because of past courier losses there, not because
 * every customer in it is a risk. "Proven" means: at least one earlier order
 * that was paid online (not itself COD) and actually reached them (status
 * 'delivered'), and never a delivery that failed (an order cancelled with
 * cancellation_reason 'failed_delivery'). A brand-new customer, or one whose
 * only history is unpaid/cancelled/still-in-transit orders, doesn't qualify
 * — COD in a flagged city has to be earned by a completed paid order first.
 *
 * customers.successful_orders_count/failed_delivery_count (0001_init_schema)
 * are never actually written anywhere in this codebase (see
 * server/admin/customers.ts) — deliberately computed fresh from `orders`
 * here instead of trusting those stale columns.
 */
import type { getSupabaseAdminClient } from '#/lib/supabase/admin'

type Admin = ReturnType<typeof getSupabaseAdminClient>

export async function hasProvenCodTrust(
  admin: Admin,
  email: string,
): Promise<boolean> {
  const { data: customer, error: customerError } = await admin
    .from('customers')
    .select('id')
    .ilike('email', email)
    .maybeSingle()
  if (customerError) throw customerError
  if (!customer) return false

  const { data: orders, error } = await admin
    .from('orders')
    .select('status, is_cod, cancellation_reason')
    .eq('customer_id', customer.id)
  if (error) throw error

  const everHadFailedDelivery = orders.some(
    (o) => o.cancellation_reason === 'failed_delivery',
  )
  if (everHadFailedDelivery) return false

  return orders.some((o) => o.status === 'delivered' && !o.is_cod)
}

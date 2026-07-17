import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { customerRiskUpdateSchema } from '#/lib/validation/admin/customers'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { logStaffActivity } from './activity-log'
import type { Customer, CustomerAddress, Order } from '#/types/entities'

const MANAGE_ROLES = ['super_admin', 'admin', 'manager'] as const

export interface CustomerListRow extends Customer {
  orders_count: number
}

/**
 * The customers table has its own successful_orders_count/
 * cancelled_orders_count/failed_delivery_count/return_count columns, but
 * nothing in this codebase ever increments them — they'd just be stuck at
 * whatever the DB default is. Counting real rows instead so these numbers
 * actually reflect the customer's order history.
 */
async function computeCustomerOrderCounts(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  customerIds: string[],
): Promise<
  Map<
    string,
    {
      ordersCount: number
      cancelledCount: number
      failedDeliveryCount: number
      returnCount: number
    }
  >
> {
  const counts = new Map<
    string,
    {
      ordersCount: number
      cancelledCount: number
      failedDeliveryCount: number
      returnCount: number
    }
  >()
  if (customerIds.length === 0) return counts

  const [
    { data: orders, error: ordersError },
    { data: returns, error: returnsError },
  ] = await Promise.all([
    admin
      .from('orders')
      .select('customer_id, status, cancellation_reason')
      .in('customer_id', customerIds),
    admin.from('returns').select('customer_id').in('customer_id', customerIds),
  ])
  if (ordersError) throw ordersError
  if (returnsError) throw returnsError

  for (const order of orders) {
    const bucket = counts.get(order.customer_id) ?? {
      ordersCount: 0,
      cancelledCount: 0,
      failedDeliveryCount: 0,
      returnCount: 0,
    }
    bucket.ordersCount += 1
    if (order.status === 'cancelled') {
      bucket.cancelledCount += 1
      if (order.cancellation_reason === 'failed_delivery') {
        bucket.failedDeliveryCount += 1
      }
    }
    counts.set(order.customer_id, bucket)
  }
  for (const ret of returns) {
    const bucket = counts.get(ret.customer_id) ?? {
      ordersCount: 0,
      cancelledCount: 0,
      failedDeliveryCount: 0,
      returnCount: 0,
    }
    bucket.returnCount += 1
    counts.set(ret.customer_id, bucket)
  }

  return counts
}

export const listCustomers = createServerFn({ method: 'GET' })
  .validator(z.object({ q: z.string().optional() }))
  .handler(async ({ data }): Promise<CustomerListRow[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    let query = admin
      .from('customers')
      .select('*')
      .order('created_at', { ascending: false })

    const search = data.q?.trim()
    if (search) {
      query = query.or(
        `email.ilike.%${search}%,full_name.ilike.%${search}%,phone.ilike.%${search}%`,
      )
    }

    const { data: customers, error } = await query
    if (error) throw error
    if (customers.length === 0) return []

    const counts = await computeCustomerOrderCounts(
      admin,
      customers.map((c) => c.id),
    )

    return customers.map((customer) => {
      const bucket = counts.get(customer.id)
      return {
        ...customer,
        orders_count: bucket?.ordersCount ?? 0,
        cancelled_orders_count: bucket?.cancelledCount ?? 0,
        failed_delivery_count: bucket?.failedDeliveryCount ?? 0,
        return_count: bucket?.returnCount ?? 0,
      }
    })
  })

export interface CustomerWithDetails extends Customer {
  addresses: CustomerAddress[]
  orders: Pick<
    Order,
    | 'id'
    | 'order_number'
    | 'status'
    | 'total_cents'
    | 'placed_at'
    | 'cancellation_reason'
  >[]
}

export const getCustomerById = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }): Promise<CustomerWithDetails | null> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const { data: customer, error } = await admin
      .from('customers')
      .select('*')
      .eq('id', data.id)
      .maybeSingle()
    if (error) throw error
    if (!customer) return null

    const [
      { data: addresses, error: addressesError },
      { data: orders, error: ordersError },
      { data: returns, error: returnsError },
    ] = await Promise.all([
      admin
        .from('customer_addresses')
        .select('*')
        .eq('customer_id', data.id)
        .order('created_at', { ascending: false }),
      admin
        .from('orders')
        .select(
          'id, order_number, status, total_cents, placed_at, cancellation_reason',
        )
        .eq('customer_id', data.id)
        .order('placed_at', { ascending: false }),
      admin.from('returns').select('id').eq('customer_id', data.id),
    ])
    if (addressesError) throw addressesError
    if (ordersError) throw ordersError
    if (returnsError) throw returnsError

    // See computeCustomerOrderCounts's comment — the customers table's own
    // count columns are never kept up to date, so these are counted from
    // the real order/return rows instead.
    const cancelledOrdersCount = orders.filter(
      (o) => o.status === 'cancelled',
    ).length
    const failedDeliveryCount = orders.filter(
      (o) =>
        o.status === 'cancelled' && o.cancellation_reason === 'failed_delivery',
    ).length

    return {
      ...customer,
      addresses,
      orders,
      cancelled_orders_count: cancelledOrdersCount,
      failed_delivery_count: failedDeliveryCount,
      return_count: returns.length,
    }
  })

export const updateCustomerRisk = createServerFn({ method: 'POST' })
  .validator(customerRiskUpdateSchema)
  .handler(async ({ data }): Promise<Customer> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: customer, error } = await admin
      .from('customers')
      .update({
        is_high_risk: data.isHighRisk,
        cod_blocked: data.codBlocked,
        risk_notes: data.riskNotes ?? null,
      })
      .eq('id', data.id)
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(
      staff,
      'customer.risk_update',
      'customers',
      customer.id,
      {
        isHighRisk: data.isHighRisk,
        codBlocked: data.codBlocked,
      },
    )
    return customer
  })

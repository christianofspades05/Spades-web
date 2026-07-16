import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { customerRiskUpdateSchema } from '#/lib/validation/admin/customers'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { logStaffActivity } from './activity-log'
import type { Customer, CustomerAddress, Order } from '#/types/entities'

const MANAGE_ROLES = ['super_admin', 'admin', 'manager'] as const

export const listCustomers = createServerFn({ method: 'GET' })
  .validator(z.object({ q: z.string().optional() }))
  .handler(
    async ({ data }): Promise<(Customer & { orders_count: number })[]> => {
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

      // successful_orders_count is a risk-tracking counter nothing currently
      // maintains — count real rows instead so "Orders" reflects how many
      // times the customer has actually bought.
      const { data: orders, error: ordersError } = await admin
        .from('orders')
        .select('customer_id')
        .in(
          'customer_id',
          customers.map((c) => c.id),
        )
      if (ordersError) throw ordersError

      const countMap = new Map<string, number>()
      for (const order of orders) {
        countMap.set(
          order.customer_id,
          (countMap.get(order.customer_id) ?? 0) + 1,
        )
      }

      return customers.map((customer) => ({
        ...customer,
        orders_count: countMap.get(customer.id) ?? 0,
      }))
    },
  )

interface CustomerWithDetails extends Customer {
  addresses: CustomerAddress[]
  orders: Pick<
    Order,
    'id' | 'order_number' | 'status' | 'total_cents' | 'placed_at'
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
    ] = await Promise.all([
      admin
        .from('customer_addresses')
        .select('*')
        .eq('customer_id', data.id)
        .order('created_at', { ascending: false }),
      admin
        .from('orders')
        .select('id, order_number, status, total_cents, placed_at')
        .eq('customer_id', data.id)
        .order('placed_at', { ascending: false }),
    ])
    if (addressesError) throw addressesError
    if (ordersError) throw ordersError

    return { ...customer, addresses: addresses ?? [], orders: orders ?? [] }
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

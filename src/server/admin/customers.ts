import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { customerRiskUpdateSchema } from '#/lib/validation/admin/customers'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { chunkArray, fetchAllRows } from '#/lib/utils/paginate'
import { logStaffActivity } from './activity-log'
import type { Customer, CustomerAddress, Order } from '#/types/entities'

const MANAGE_ROLES = ['super_admin', 'admin', 'manager'] as const

export interface CustomerListRow extends Customer {
  orders_count: number
  amount_spent_cents: number
}

const VOID_ORDER_STATUSES = new Set(['cancelled', 'failed'])

interface CustomerOrderBucket {
  ordersCount: number
  cancelledCount: number
  failedDeliveryCount: number
  returnCount: number
  spentCents: number
}

function aggregateOrderCounts(
  orders: Pick<Order, 'customer_id' | 'status' | 'cancellation_reason' | 'total_cents'>[],
  returns: { customer_id: string }[],
): Map<string, CustomerOrderBucket> {
  const counts = new Map<string, CustomerOrderBucket>()
  for (const order of orders) {
    const bucket = counts.get(order.customer_id) ?? {
      ordersCount: 0,
      cancelledCount: 0,
      failedDeliveryCount: 0,
      returnCount: 0,
      spentCents: 0,
    }
    bucket.ordersCount += 1
    if (order.status === 'cancelled') {
      bucket.cancelledCount += 1
      if (order.cancellation_reason === 'failed_delivery') {
        bucket.failedDeliveryCount += 1
      }
    }
    if (!VOID_ORDER_STATUSES.has(order.status)) {
      bucket.spentCents += order.total_cents
    }
    counts.set(order.customer_id, bucket)
  }
  for (const ret of returns) {
    const bucket = counts.get(ret.customer_id) ?? {
      ordersCount: 0,
      cancelledCount: 0,
      failedDeliveryCount: 0,
      returnCount: 0,
      spentCents: 0,
    }
    bucket.returnCount += 1
    counts.set(ret.customer_id, bucket)
  }
  return counts
}

/**
 * The customers table has its own successful_orders_count/
 * cancelled_orders_count/failed_delivery_count/return_count columns, but
 * nothing in this codebase ever increments them — they'd just be stuck at
 * whatever the DB default is. Counting real rows instead so these numbers
 * actually reflect the customer's order history. Bounded to a small,
 * already-known id list (one page, or one channel's customers) — cheap.
 */
async function computeCustomerOrderCounts(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  customerIds: string[],
): Promise<Map<string, CustomerOrderBucket>> {
  if (customerIds.length === 0) return new Map()

  const [
    { data: orders, error: ordersError },
    { data: returns, error: returnsError },
  ] = await Promise.all([
    admin
      .from('orders')
      .select('customer_id, status, cancellation_reason, total_cents')
      .in('customer_id', customerIds),
    admin.from('returns').select('customer_id').in('customer_id', customerIds),
  ])
  if (ordersError) throw ordersError
  if (returnsError) throw returnsError

  return aggregateOrderCounts(orders, returns)
}

/**
 * Same aggregation, but for every customer at once rather than a known id
 * list — needed to sort the full customers table by a derived metric
 * (orders/amount spent/cancelled/returns), since those have no backing
 * column to ORDER BY at the database level. customers can run to 50k+ rows
 * (mostly imported guests with zero local orders), but orders/returns
 * themselves are small (low thousands) — scanning those two tables whole
 * and joining in memory is far cheaper than chunking a 50k-id list into
 * hundreds of `.in()` calls against them.
 */
async function computeAllCustomerOrderCounts(
  admin: ReturnType<typeof getSupabaseAdminClient>,
): Promise<Map<string, CustomerOrderBucket>> {
  const [orders, returns] = await Promise.all([
    fetchAllRows((offset) =>
      admin
        .from('orders')
        .select('customer_id, status, cancellation_reason, total_cents')
        .range(offset, offset + 999),
    ),
    fetchAllRows((offset) =>
      admin.from('returns').select('customer_id').range(offset, offset + 999),
    ),
  ])
  return aggregateOrderCounts(orders, returns)
}

const customerFilterSchema = z.object({
  q: z.string().optional(),
  source: z
    .enum(['storefront', 'admin', 'tiktok_shop', 'shopee', 'lazada'])
    .optional(),
})

// "Channel" isn't a customer-table column — a customer can order through
// more than one channel — so this resolves to the ids of customers who have
// placed at least one order via the selected source.
async function resolveSourceCustomerIds(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  source: NonNullable<z.infer<typeof customerFilterSchema>['source']>,
): Promise<string[]> {
  const ids = new Set<string>()
  // PostgREST caps unfiltered selects at 1000 rows, so a channel with more
  // orders than that needs paging through, not a single unbounded select.
  for (let offset = 0; ; offset += 1000) {
    const { data: page, error } = await admin
      .from('orders')
      .select('customer_id')
      .eq('source', source)
      .range(offset, offset + 999)
    if (error) throw error
    for (const row of page) ids.add(row.customer_id)
    if (page.length < 1000) break
  }

  // Customers imported from the Shopify Online Store export have no rows
  // in `orders` at all (see migration 0030) — the orders-derived lookup
  // above would never surface them as "storefront" customers otherwise.
  if (source === 'storefront') {
    for (let offset = 0; ; offset += 1000) {
      const { data: page, error } = await admin
        .from('customers')
        .select('id')
        .not('imported_source', 'is', null)
        .range(offset, offset + 999)
      if (error) throw error
      for (const row of page) ids.add(row.id)
      if (page.length < 1000) break
    }
  }

  return Array.from(ids)
}

// Same reasoning as computeCustomerOrderCounts: a channel like TikTok Shop
// can have well over a thousand distinct customers, and PostgREST rejects a
// `.in('id', ...)` query string once it gets that long with a 400. Splitting
// into id chunks keeps every individual request well under that limit.
const CUSTOMER_ID_CHUNK_SIZE = 200

const CUSTOMER_SORT_BY = [
  'name',
  'orders',
  'amount_spent',
  'cancelled',
  'returns',
] as const

function buildSearchClause(search: string): string {
  return `email.ilike.%${search}%,full_name.ilike.%${search}%,phone.ilike.%${search}%`
}

/**
 * Every customer matching the current filters, narrowed to just the columns
 * a sort key needs (not a full row) — used only when sorting by a derived
 * metric, where every match has to be scored and ordered before slicing to
 * a page. A channel filter already has its id list from
 * resolveSourceCustomerIds, so this only re-queries `customers` in
 * id-bounded chunks; with no channel filter it scans the whole table once,
 * paginated, applying search at the database level.
 */
async function fetchSortableCustomerRows(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  source: NonNullable<z.infer<typeof customerFilterSchema>['source']> | undefined,
  search: string | undefined,
): Promise<
  Pick<Customer, 'id' | 'imported_total_spent_cents'>[]
> {
  if (source) {
    const customerIds = await resolveSourceCustomerIds(admin, source)
    if (customerIds.length === 0) return []
    const chunkResults = await Promise.all(
      chunkArray(customerIds, CUSTOMER_ID_CHUNK_SIZE).map(async (ids) => {
        let query = admin
          .from('customers')
          .select('id, imported_total_spent_cents')
          .in('id', ids)
        if (search) query = query.or(buildSearchClause(search))
        const { data: rows, error } = await query
        if (error) throw error
        return rows
      }),
    )
    return chunkResults.flat()
  }

  return fetchAllRows((offset) => {
    let query = admin
      .from('customers')
      .select('id, imported_total_spent_cents')
      .range(offset, offset + 999)
    if (search) query = query.or(buildSearchClause(search))
    return query
  })
}

// PostgREST's `.or()` filter syntax treats `,`, `(`, and `)` as delimiters,
// so a search term containing any of them (e.g. "Dela Cruz, Juan") breaks
// the filter grammar and PostgREST rejects the whole request with a 400.
// Strip them out rather than trying to escape them.
function sanitizeSearch(q: string | undefined): string | undefined {
  const cleaned = q?.trim().replace(/[,()]/g, ' ').trim()
  return cleaned || undefined
}

export const listCustomers = createServerFn({ method: 'GET' })
  .validator(
    customerFilterSchema.extend({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(50),
      sortBy: z.enum(CUSTOMER_SORT_BY).optional(),
      sortDir: z.enum(['asc', 'desc']).default('asc'),
    }),
  )
  .handler(async ({ data }): Promise<CustomerListRow[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const search = sanitizeSearch(data.q)
    const offset = (data.page - 1) * data.pageSize
    const ascending = data.sortDir === 'asc'

    let customers: Customer[]

    if (!data.source && (!data.sortBy || data.sortBy === 'name')) {
      // Cheapest path: no channel filter, and either no sort or sorting by
      // a real column (full_name) — a single DB-level order+range query,
      // same cost no matter how many customers exist in total.
      let query = admin.from('customers').select('*')
      if (search) query = query.or(buildSearchClause(search))
      query =
        data.sortBy === 'name'
          ? query.order('full_name', { ascending })
          : query.order('created_at', { ascending: false })
      query = query.range(offset, offset + data.pageSize - 1)

      const { data: rows, error } = await query
      if (error) throw error
      customers = rows
    } else if (data.sortBy && data.sortBy !== 'name') {
      // Sorting by a derived metric (orders/amount spent/cancelled/
      // returns) has no backing column to ORDER BY, so every matching
      // customer needs a computed sort key before slicing to a page.
      const sortKeyRows = await fetchSortableCustomerRows(admin, data.source, search)
      if (sortKeyRows.length === 0) return []

      const countsMap = await computeAllCustomerOrderCounts(admin)
      const withSortKey = sortKeyRows.map((row) => {
        const bucket = countsMap.get(row.id)
        return {
          id: row.id,
          ordersCount: bucket?.ordersCount ?? 0,
          amountSpentCents:
            (bucket?.spentCents ?? 0) + (row.imported_total_spent_cents ?? 0),
          cancelledCount: bucket?.cancelledCount ?? 0,
          returnCount:
            (bucket?.returnCount ?? 0) + (bucket?.failedDeliveryCount ?? 0),
        }
      })
      withSortKey.sort((a, b) => {
        const cmp =
          data.sortBy === 'orders'
            ? a.ordersCount - b.ordersCount
            : data.sortBy === 'amount_spent'
              ? a.amountSpentCents - b.amountSpentCents
              : data.sortBy === 'cancelled'
                ? a.cancelledCount - b.cancelledCount
                : a.returnCount - b.returnCount
        return ascending ? cmp : -cmp
      })

      const pageIds = withSortKey
        .slice(offset, offset + data.pageSize)
        .map((r) => r.id)
      if (pageIds.length === 0) return []

      const { data: pageRows, error } = await admin
        .from('customers')
        .select('*')
        .in('id', pageIds)
      if (error) throw error
      // .in() doesn't preserve the requested order — restore it.
      const byId = new Map(pageRows.map((r) => [r.id, r]))
      customers = pageIds
        .map((id) => byId.get(id))
        .filter((c): c is Customer => c != null)
    } else {
      // Channel filter active, no explicit sort — same "fetch every
      // matching customer, sort by newest first, slice" as before.
      const customerIds = await resolveSourceCustomerIds(admin, data.source!)
      if (customerIds.length === 0) return []

      const chunkResults = await Promise.all(
        chunkArray(customerIds, CUSTOMER_ID_CHUNK_SIZE).map(async (ids) => {
          let query = admin.from('customers').select('*').in('id', ids)
          if (search) query = query.or(buildSearchClause(search))
          const { data: rows, error } = await query
          if (error) throw error
          return rows
        }),
      )
      customers = chunkResults
        .flat()
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(offset, offset + data.pageSize)
    }

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
        // A failed-delivery cancellation is a courier-side non-delivery —
        // there's no separate `returns` row for it (the order never
        // reaches the buyer to be "returned"), but it's the same real-world
        // outcome as a marketplace return, so it counts as one here too.
        // Matches the combined Failed Delivery/Return metric on the
        // Cancelled & Returns analytics page.
        return_count:
          (bucket?.returnCount ?? 0) + (bucket?.failedDeliveryCount ?? 0),
        // Live spend from this site's own orders, plus whatever historical
        // spend was imported from the old Shopify store (null for anyone
        // who wasn't in that export) — see migration 0029.
        amount_spent_cents:
          (bucket?.spentCents ?? 0) +
          (customer.imported_total_spent_cents ?? 0),
      }
    })
  })

// Separate head-count query rather than bundled into listCustomers, matching
// the pattern in server/admin/orders.ts (listOrders/getOrdersCount).
export const getCustomersCount = createServerFn({ method: 'GET' })
  .validator(customerFilterSchema)
  .handler(async ({ data }): Promise<{ total: number }> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const search = sanitizeSearch(data.q)

    if (data.source) {
      const customerIds = await resolveSourceCustomerIds(admin, data.source)
      if (customerIds.length === 0) return { total: 0 }

      const chunkCounts = await Promise.all(
        chunkArray(customerIds, CUSTOMER_ID_CHUNK_SIZE).map(async (ids) => {
          let query = admin
            .from('customers')
            .select('id', { count: 'exact', head: true })
            .in('id', ids)
          if (search) query = query.or(buildSearchClause(search))
          const { count, error } = await query
          if (error) throw error
          return count ?? 0
        }),
      )
      return { total: chunkCounts.reduce((sum, c) => sum + c, 0) }
    }

    let query = admin
      .from('customers')
      .select('id', { count: 'exact', head: true })
    if (search) query = query.or(buildSearchClause(search))

    const { count, error } = await query
    if (error) throw error
    return { total: count ?? 0 }
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
  amount_spent_cents: number
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
    const liveSpentCents = orders
      .filter((o) => !VOID_ORDER_STATUSES.has(o.status))
      .reduce((sum, o) => sum + o.total_cents, 0)

    return {
      ...customer,
      addresses,
      orders,
      cancelled_orders_count: cancelledOrdersCount,
      failed_delivery_count: failedDeliveryCount,
      // See listCustomers's comment — a failed-delivery cancellation counts
      // as a return too, same as the analytics page's combined metric.
      return_count: returns.length + failedDeliveryCount,
      amount_spent_cents: liveSpentCents + (customer.imported_total_spent_cents ?? 0),
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

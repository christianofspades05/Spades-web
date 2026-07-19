/**
 * Reads for the signed-in customer's own account page. Uses the anon-key
 * request client (respects RLS), not the admin client — the "customers
 * select own orders/addresses/shipments" policies in 0001_init_schema.sql
 * already scope these to auth.uid(), so there's no reason to run elevated.
 */
import { createServerFn } from '@tanstack/react-start'
import { requireCustomer } from '#/lib/auth/guards'
import { recoverFromBadSession } from '#/lib/auth/session'
import { getSupabaseServerClient } from '#/lib/supabase/server'
import type {
  Customer,
  CustomerAddress,
  Order,
  OrderItem,
} from '#/types/entities'

/** Mirrors the fulfillment definition used by the admin orders list (src/routes/admin/orders/index.tsx). */
const FULFILLED_SHIPMENT_STATUSES = new Set([
  'packed',
  'in_transit',
  'out_for_delivery',
  'delivered',
])
/**
 * order_items only stores product/variant name snapshots, not an image —
 * this looks the current product image up via product_variants (which,
 * unlike orders/order_items, has a real Relationships entry in
 * database.types.ts, so the embedded select type-checks cleanly). Mirrors
 * the same helper in src/server/admin/orders.ts.
 */
async function getProductImagesByVariantId(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  variantIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  if (variantIds.length === 0) return map

  const { data, error } = await supabase
    .from('product_variants')
    .select('id, product:products(images)')
    .in('id', variantIds)
  // TEMPORARY — see the matching tags in loadAccountOverview.
  if (error) throw new Error(`variants-query:${JSON.stringify(error)}`)

  for (const row of data) {
    map.set(row.id, row.product.images[0] ?? null)
  }
  return map
}

const TERMINAL_ORDER_STATUSES = new Set([
  'cancelled',
  'refunded',
  'failed',
  'delivered',
])

export interface AccountOrderItem extends Pick<
  OrderItem,
  'id' | 'product_name_snapshot' | 'variant_label_snapshot' | 'quantity'
> {
  image_url: string | null
}

export interface AccountOrder extends Pick<
  Order,
  'id' | 'order_number' | 'status' | 'total_cents' | 'placed_at' | 'is_cod'
> {
  /** COD, not yet fulfilled, not already in a terminal state — see cancelMyOrder for the same rule enforced server-side. */
  canCancel: boolean
  /** Delivered orders can be reviewed from the account page — see getOrderReviewProducts for the same rule enforced server-side. */
  canReview: boolean
  items: AccountOrderItem[]
  isFulfilled: boolean
  trackingNumber: string | null
  trackingUrl: string | null
}

export interface AccountOverview {
  customer: Customer
  orders: AccountOrder[]
  addresses: CustomerAddress[]
}

export interface AccountOverviewResult {
  overview: AccountOverview | null
  // TEMPORARY — see the matching TEMPORARY block in routes/account/index.tsx.
  debugReason?: string
}

export const getAccountOverview = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AccountOverviewResult> => {
    try {
      return { overview: await loadAccountOverview() }
    } catch (err) {
      // requireCustomer() above can succeed fine (that path already
      // recovers from a bad session cookie on its own — see
      // lib/auth/session.ts) while these RLS-scoped queries still fail on
      // the exact same cookie: Kong/PostgREST can reject a borderline-
      // invalid JWT more strictly than Supabase's own Auth API does. Same
      // recovery either way — clear the bad cookies and signal the route
      // to send the user to log in again, instead of leaving the page
      // permanently broken for this one browser.
      recoverFromBadSession()
      // TEMPORARY — plain JSON.stringify(err) silently produces "{}" for a
      // real Error instance (message/stack aren't enumerable), so the tagged
      // errors thrown above would've shown up empty. Pull .message out
      // explicitly instead.
      const debugReason =
        err instanceof Error ? err.message : JSON.stringify(err)
      return { overview: null, debugReason }
    }
  },
)

async function loadAccountOverview(): Promise<AccountOverview> {
  const customer = await requireCustomer()
  const supabase = getSupabaseServerClient()

  const [
    { data: orders, error: ordersError },
    { data: addresses, error: addressesError },
  ] = await Promise.all([
    supabase
      .from('orders')
      .select(
        'id, order_number, status, total_cents, placed_at, is_cod, order_items(id, product_name_snapshot, variant_label_snapshot, quantity, variant_id)',
      )
      .order('placed_at', { ascending: false }),
    supabase
      .from('customer_addresses')
      .select('*')
      .order('created_at', { ascending: false }),
  ])
  // TEMPORARY — tags which query actually failed, since the caught error
  // itself carries no other detail (no hint/code/details, just a bare
  // "Bad Request" message) to tell them apart otherwise.
  if (ordersError) throw new Error(`orders-query:${JSON.stringify(ordersError)}`)
  if (addressesError)
    throw new Error(`addresses-query:${JSON.stringify(addressesError)}`)

  const orderIds = orders.map((o) => o.id)
  const { data: shipments, error: shipmentsError } =
    orderIds.length > 0
      ? await supabase
          .from('shipments')
          .select('order_id, status, tracking_number, tracking_url')
          .in('order_id', orderIds)
      : { data: [], error: null }
  if (shipmentsError)
    throw new Error(`shipments-query:${JSON.stringify(shipmentsError)}`)

  const fulfilledOrderIds = new Set(
    shipments
      .filter((s) => FULFILLED_SHIPMENT_STATUSES.has(s.status))
      .map((s) => s.order_id),
  )
  // "Delivered" can be recorded two ways in the admin: the order's own
  // status field (shipped -> delivered transition), or the shipment's own
  // status field (set independently from the shipment/tracking form) — a
  // review should be offered either way.
  const deliveredOrderIds = new Set(
    shipments.filter((s) => s.status === 'delivered').map((s) => s.order_id),
  )
  const shipmentByOrderId = new Map(shipments.map((s) => [s.order_id, s]))

  const variantIds = Array.from(
    new Set(
      orders.flatMap((o) =>
        o.order_items.map((i) => i.variant_id).filter((v): v is string => !!v),
      ),
    ),
  )
  const imageMap = await getProductImagesByVariantId(supabase, variantIds)

  return {
    customer,
    orders: orders.map((order) => ({
      ...order,
      canCancel:
        order.is_cod &&
        !TERMINAL_ORDER_STATUSES.has(order.status) &&
        !fulfilledOrderIds.has(order.id),
      canReview:
        order.status === 'delivered' || deliveredOrderIds.has(order.id),
      items: order.order_items.map((item) => ({
        ...item,
        image_url: item.variant_id
          ? (imageMap.get(item.variant_id) ?? null)
          : null,
      })),
      isFulfilled: fulfilledOrderIds.has(order.id),
      trackingNumber: shipmentByOrderId.get(order.id)?.tracking_number ?? null,
      trackingUrl: shipmentByOrderId.get(order.id)?.tracking_url ?? null,
    })),
    addresses,
  }
}

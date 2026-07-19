/**
 * Reads for the signed-in customer's own account page. Uses the admin
 * client with an explicit customer_id filter, not the RLS-scoped anon-key
 * client — requireCustomer() below already establishes who's asking via a
 * robust, admin-client-based lookup (see lib/auth/session.ts), so there's
 * no need to also re-forward the browser's own session cookie/JWT to
 * PostgREST for these reads. That path turned out to be fragile: a
 * diagnostic session (signing in fresh via the Auth API directly, bypassing
 * the browser entirely) proved the query/RLS policy were correct, but the
 * *browser's stored* session could still fail a query mid-page-load — most
 * likely a token refresh rotating the session between this page's separate
 * beforeLoad and loader requests. Filtering explicitly by customer_id sits
 * on the same safe, already-proven pattern every admin/* server function
 * uses (admin client + explicit filters, no RLS dependency) and removes an
 * entire class of cookie-freshness failures for a read that doesn't need
 * per-request RLS anyway.
 */
import { createServerFn } from '@tanstack/react-start'
import { requireCustomer } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
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
  admin: ReturnType<typeof getSupabaseAdminClient>,
  variantIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>()
  if (variantIds.length === 0) return map

  const { data, error } = await admin
    .from('product_variants')
    .select('id, product:products(images)')
    .in('id', variantIds)
  if (error) throw error

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

export const getAccountOverview = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AccountOverview> => {
    const customer = await requireCustomer()
    const admin = getSupabaseAdminClient()

    const [
      { data: orders, error: ordersError },
      { data: addresses, error: addressesError },
    ] = await Promise.all([
      admin
        .from('orders')
        .select(
          'id, order_number, status, total_cents, placed_at, is_cod, order_items(id, product_name_snapshot, variant_label_snapshot, quantity, variant_id)',
        )
        .eq('customer_id', customer.id)
        .order('placed_at', { ascending: false }),
      admin
        .from('customer_addresses')
        .select('*')
        .eq('customer_id', customer.id)
        .order('created_at', { ascending: false }),
    ])
    if (ordersError) throw ordersError
    if (addressesError) throw addressesError

    const orderIds = orders.map((o) => o.id)
    const { data: shipments, error: shipmentsError } =
      orderIds.length > 0
        ? await admin
            .from('shipments')
            .select('order_id, status, tracking_number, tracking_url')
            .in('order_id', orderIds)
        : { data: [], error: null }
    if (shipmentsError) throw shipmentsError

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
          o.order_items
            .map((i) => i.variant_id)
            .filter((v): v is string => !!v),
        ),
      ),
    )
    const imageMap = await getProductImagesByVariantId(admin, variantIds)

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
        trackingNumber:
          shipmentByOrderId.get(order.id)?.tracking_number ?? null,
        trackingUrl: shipmentByOrderId.get(order.id)?.tracking_url ?? null,
      })),
      addresses,
    }
  },
)

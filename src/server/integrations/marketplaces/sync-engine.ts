/**
 * The core orchestration layer every cron job / admin action goes through.
 * This file never imports a platform-specific client — only ./registry.ts
 * (which resolves a MarketplaceName to a MarketplaceAdapter) and the
 * MarketplaceAdapter interface. Adding Shopee/Lazada support later never
 * requires touching this file.
 */
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { getErrorMessage } from '#/lib/utils/errors'
import { getAdapter, IMPLEMENTED_MARKETPLACES } from './registry'
import type {
  MarketplaceCategory,
  MarketplaceCategoryAttribute,
  MarketplaceCategoryAttributeAnswer,
  NormalizedOrder,
  SyncableMarketplace,
} from './types'
import { MarketplaceNotConnectedError } from './types'
import type { MarketplaceConnection, MarketplaceName } from '#/types/entities'

const MAX_ATTEMPTS = 3
const BASE_RETRY_DELAY_MS = 500
const STATUSES_BEFORE_SHIPPED = new Set([
  'pending_payment',
  'paid',
  'processing',
  'packed',
])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function logSync(
  marketplace: MarketplaceName,
  operation: string,
  status: 'success' | 'failed',
  detail: Record<string, unknown>,
  errorMessage?: string,
): Promise<void> {
  const admin = getSupabaseAdminClient()
  await admin.from('sync_logs').insert({
    marketplace,
    operation,
    status,
    detail,
    error_message: errorMessage ?? null,
  })
}

async function getActiveConnection(
  marketplace: MarketplaceName,
): Promise<MarketplaceConnection | null> {
  const admin = getSupabaseAdminClient()
  const { data, error } = await admin
    .from('marketplace_connections')
    .select('*')
    .eq('marketplace', marketplace)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  return data
}

/**
 * Ensures the connection's access token is still valid, refreshing it first
 * if it's expired (or about to, within a 5-minute buffer). Every call site
 * that's about to use a connection's token should go through this rather
 * than reading access_token_encrypted directly.
 */
async function ensureFreshConnection(
  connection: MarketplaceConnection,
): Promise<MarketplaceConnection> {
  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime()
    : 0
  const needsRefresh = expiresAt - Date.now() < 5 * 60 * 1000
  if (!needsRefresh || !connection.refresh_token_encrypted) return connection

  const admin = getSupabaseAdminClient()
  const adapter = getAdapter(connection.marketplace)
  try {
    const tokens = await adapter.refreshTokens(
      connection.refresh_token_encrypted,
    )
    const { data: updated, error } = await admin
      .from('marketplace_connections')
      .update({
        access_token_encrypted: tokens.accessToken,
        refresh_token_encrypted: tokens.refreshToken,
        token_expires_at: tokens.tokenExpiresAt,
        status: 'active',
      })
      .eq('id', connection.id)
      .select('*')
      .single()
    if (error) throw error
    await logSync(connection.marketplace, 'refresh_token', 'success', {
      connectionId: connection.id,
    })
    return updated
  } catch (err) {
    await logSync(
      connection.marketplace,
      'refresh_token',
      'failed',
      { connectionId: connection.id },
      getErrorMessage(err),
    )
    await admin
      .from('marketplace_connections')
      .update({ status: 'error' })
      .eq('id', connection.id)
    throw err
  }
}

// ---------------------------------------------------------------------------
// Inventory push
// ---------------------------------------------------------------------------

interface MappingRow {
  id: string
  marketplace_connection_id: string
  external_variant_id: string
}

async function pushOneMapping(
  connection: MarketplaceConnection,
  mapping: MappingRow,
  quantity: number,
): Promise<void> {
  // Inventory sync is an explicit per-channel opt-in (off by default) — a
  // channel connected here may already have its stock managed by another
  // tool (e.g. an existing Shopify sync app), and pushing our numbers
  // uninvited risks visibly overwriting whatever that other tool just set.
  if (!connection.inventory_sync_enabled) return

  const admin = getSupabaseAdminClient()
  const adapter = getAdapter(connection.marketplace)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const fresh = await ensureFreshConnection(connection)
      await adapter.pushInventory(fresh, mapping.external_variant_id, quantity)
      await admin
        .from('marketplace_product_mappings')
        .update({
          sync_status: 'synced',
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', mapping.id)
      await logSync(connection.marketplace, 'push_inventory', 'success', {
        mappingId: mapping.id,
        quantity,
        attempt,
      })
      return
    } catch (err) {
      await logSync(
        connection.marketplace,
        'push_inventory',
        'failed',
        { mappingId: mapping.id, quantity, attempt },
        getErrorMessage(err),
      )
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_RETRY_DELAY_MS * 2 ** (attempt - 1))
      }
    }
  }

  await admin
    .from('marketplace_product_mappings')
    .update({ sync_status: 'error' })
    .eq('id', mapping.id)
}

/**
 * Pushes this variant's current available stock to every marketplace it's
 * mapped to. Known limitation (last-write-wins): if the same variant sells
 * on two channels within moments of each other, whichever push lands last
 * "wins" and the other channel briefly shows a stale count until the next
 * push/reconciliation — there's no cross-channel stock lock. Acceptable for
 * now; revisit if oversells become a real problem.
 */
export async function pushInventoryForVariant(
  variantId: string,
): Promise<void> {
  const admin = getSupabaseAdminClient()

  const { data: inventoryRow, error: inventoryError } = await admin
    .from('inventory')
    .select('quantity_available')
    .eq('variant_id', variantId)
    .maybeSingle()
  if (inventoryError) throw inventoryError
  const quantity = inventoryRow?.quantity_available ?? 0

  const { data: mappings, error: mappingsError } = await admin
    .from('marketplace_product_mappings')
    .select('id, marketplace_connection_id, external_variant_id')
    .eq('variant_id', variantId)
  if (mappingsError) throw mappingsError
  if (mappings.length === 0) return

  const connectionIds = Array.from(
    new Set(mappings.map((m) => m.marketplace_connection_id)),
  )
  const { data: connections, error: connectionsError } = await admin
    .from('marketplace_connections')
    .select('*')
    .in('id', connectionIds)
  if (connectionsError) throw connectionsError
  const connectionsById = new Map(connections.map((c) => [c.id, c]))

  for (const mapping of mappings) {
    const connection = connectionsById.get(mapping.marketplace_connection_id)
    if (!connection || connection.status !== 'active') continue
    await pushOneMapping(connection, mapping, quantity)
  }
}

/** Re-pushes every synced mapping for a marketplace — used by the reconcile cron and the admin "Sync all" button. */
export async function pushInventoryForAllProducts(
  marketplace: MarketplaceName,
): Promise<{ attempted: number }> {
  const admin = getSupabaseAdminClient()
  const connection = await getActiveConnection(marketplace)
  if (!connection) throw new MarketplaceNotConnectedError(marketplace)

  const { data: mappings, error } = await admin
    .from('marketplace_product_mappings')
    .select('id, marketplace_connection_id, external_variant_id, variant_id')
    .eq('marketplace_connection_id', connection.id)
  if (error) throw error

  for (const mapping of mappings) {
    const { data: inventoryRow } = await admin
      .from('inventory')
      .select('quantity_available')
      .eq('variant_id', mapping.variant_id)
      .maybeSingle()
    await pushOneMapping(
      connection,
      mapping,
      inventoryRow?.quantity_available ?? 0,
    )
  }

  return { attempted: mappings.length }
}

// ---------------------------------------------------------------------------
// Order pull
// ---------------------------------------------------------------------------

/**
 * Inserts one normalized order if it isn't already imported (de-duped on
 * the existing unique (source, external_order_id) index — see
 * 0001_init_schema.sql). Returns false without erroring if it's a repeat,
 * so pulling the same time window twice is always safe.
 */
const PICKED_UP_FULFILLMENT_STATUSES = new Set(['in_transit', 'delivered'])

/**
 * Records the order's fulfillment progress (pending/packed/in_transit/
 * delivered) as reported by the platform's own dashboard — safe to call on
 * every pull, not just the first time an order is seen, since it no-ops
 * once nothing's changed since the last call.
 */
async function syncFulfillmentInfo(
  orderId: string,
  fulfillmentInfo: NormalizedOrder['fulfillmentInfo'],
): Promise<void> {
  if (!fulfillmentInfo) return
  const admin = getSupabaseAdminClient()

  const { data: shipment, error: shipmentError } = await admin
    .from('shipments')
    .select('id, status, tracking_number')
    .eq('order_id', orderId)
    .maybeSingle()
  if (shipmentError) throw shipmentError
  if (
    shipment?.status === fulfillmentInfo.status &&
    shipment.tracking_number === fulfillmentInfo.trackingNumber
  ) {
    return
  }

  const now = new Date().toISOString()
  const patch = {
    order_id: orderId,
    carrier: fulfillmentInfo.carrier,
    tracking_number: fulfillmentInfo.trackingNumber,
    status: fulfillmentInfo.status,
    shipped_at: fulfillmentInfo.status === 'in_transit' ? now : undefined,
    delivered_at: fulfillmentInfo.status === 'delivered' ? now : undefined,
  }
  if (shipment) {
    await admin.from('shipments').update(patch).eq('id', shipment.id)
  } else {
    await admin.from('shipments').insert(patch)
  }

  // Also advance the order's own status (drives the status filter pills on
  // the admin Orders page, separate from the shipment record above) — only
  // once the courier has actually picked it up (matching the distinction
  // the seller's existing Shopify-side sync app makes: arranging shipment
  // isn't the same as being fulfilled), and only moving it forward, never
  // overwriting something further along like delivered, or a cancelled/
  // refunded/failed order.
  if (PICKED_UP_FULFILLMENT_STATUSES.has(fulfillmentInfo.status)) {
    const { data: order, error: orderReadError } = await admin
      .from('orders')
      .select('status')
      .eq('id', orderId)
      .single()
    if (orderReadError) throw orderReadError
    if (STATUSES_BEFORE_SHIPPED.has(order.status)) {
      await admin.from('orders').update({ status: 'shipped' }).eq('id', orderId)
    }
  }
}

async function importOrder(
  marketplace: SyncableMarketplace,
  normalized: NormalizedOrder,
  raw: Record<string, unknown>,
): Promise<boolean> {
  const admin = getSupabaseAdminClient()

  const { data: existing, error: existingError } = await admin
    .from('orders')
    .select('id')
    .eq('source', marketplace)
    .eq('external_order_id', normalized.externalOrderId)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing) {
    await syncFulfillmentInfo(existing.id, normalized.fulfillmentInfo)
    return false
  }

  const email = normalized.shippingAddress.email.trim().toLowerCase() || null
  let customerId: string
  const { data: existingCustomer, error: customerLookupError } = email
    ? await admin
        .from('customers')
        .select('id')
        .eq('email', email)
        .maybeSingle()
    : { data: null, error: null }
  if (customerLookupError) throw customerLookupError

  if (existingCustomer) {
    customerId = existingCustomer.id
  } else {
    const { data: newCustomer, error: createCustomerError } = await admin
      .from('customers')
      .insert({
        email:
          email ??
          `${marketplace}-${normalized.externalOrderId}@no-email.invalid`,
        phone: normalized.shippingAddress.phone,
        full_name: normalized.shippingAddress.recipientName,
        is_guest: true,
      })
      .select('id')
      .single()
    if (createCustomerError) throw createCustomerError
    customerId = newCustomer.id
  }

  const { data: order, error: orderError } = await admin
    .from('orders')
    .insert({
      customer_id: customerId,
      status: normalized.isPaid ? 'paid' : 'pending_payment',
      source: marketplace,
      external_order_id: normalized.externalOrderId,
      platform_order_data: raw,
      subtotal_cents: normalized.subtotalCents,
      discount_cents: 0,
      shipping_cents: normalized.shippingCents,
      total_cents: normalized.totalCents,
      shipping_address: normalized.shippingAddress as unknown as Record<
        string,
        unknown
      >,
      is_cod: false,
      placed_at: normalized.placedAt,
    })
    .select('id')
    .single()
  if (orderError) throw orderError

  // Resolve each line item's marketplace SKU to one of our variants via
  // marketplace_product_mappings. Unmapped items still get inserted (so the
  // order isn't silently incomplete) with variant_id left null — staff can
  // reconcile those manually from the order detail page.
  const { data: connection } = await admin
    .from('marketplace_connections')
    .select('id')
    .eq('marketplace', marketplace)
    .maybeSingle()

  const externalVariantIds = normalized.items.map((i) => i.externalVariantId)
  const { data: mappings } = connection
    ? await admin
        .from('marketplace_product_mappings')
        .select('external_variant_id, variant_id')
        .eq('marketplace_connection_id', connection.id)
        .in('external_variant_id', externalVariantIds)
    : { data: [] }
  const variantIdByExternalId = new Map(
    (mappings ?? []).map((m) => [m.external_variant_id, m.variant_id]),
  )

  const orderItemsPayload = normalized.items.map((item) => {
    const lineTotal = item.quantity * item.unitPriceCents
    return {
      order_id: order.id,
      variant_id: variantIdByExternalId.get(item.externalVariantId) ?? null,
      product_name_snapshot: item.productName,
      variant_label_snapshot: item.variantLabel,
      sku_snapshot: item.externalSku ?? item.externalVariantId,
      unit_price_cents: item.unitPriceCents,
      quantity: item.quantity,
      line_subtotal_cents: lineTotal,
      line_discount_cents: 0,
      line_total_cents: lineTotal,
    }
  })
  const { error: itemsError } = await admin
    .from('order_items')
    .insert(orderItemsPayload)
  if (itemsError) throw itemsError

  await admin.from('payments').insert({
    order_id: order.id,
    provider: 'other',
    status: normalized.isPaid ? 'captured' : 'pending',
    amount_cents: normalized.totalCents,
    idempotency_key: crypto.randomUUID(),
    captured_at: normalized.isPaid ? new Date().toISOString() : null,
  })

  // The sale already happened on the platform — commit stock immediately
  // (no reserve phase, unlike storefront checkout) for every line item we
  // could resolve to a real variant. If this oversells relative to what we
  // show elsewhere, that's the known last-write-wins limitation; log it
  // rather than failing the whole import, since the order is real either way.
  for (const item of normalized.items) {
    const variantId = variantIdByExternalId.get(item.externalVariantId)
    if (!variantId) continue
    const { error: stockError } = await admin.rpc('commit_variant_stock', {
      p_variant_id: variantId,
      p_quantity: item.quantity,
    })
    if (stockError) {
      await logSync(
        marketplace,
        'commit_stock_on_import',
        'failed',
        {
          orderId: order.id,
          variantId,
          quantity: item.quantity,
        },
        getErrorMessage(stockError),
      )
    }
  }

  await syncFulfillmentInfo(order.id, normalized.fulfillmentInfo)

  return true
}

export async function pullOrdersForMarketplace(
  marketplace: SyncableMarketplace,
  since: Date,
): Promise<{ scanned: number; imported: number; failed: number }> {
  const connection = await getActiveConnection(marketplace)
  if (!connection) throw new MarketplaceNotConnectedError(marketplace)

  const adapter = getAdapter(marketplace)
  const fresh = await ensureFreshConnection(connection)
  const rawOrders = await adapter.pullOrders(fresh, since)

  let imported = 0
  let failed = 0
  for (const raw of rawOrders) {
    try {
      const normalized = adapter.mapOrderToInternalFormat(raw)
      const wasImported = await importOrder(marketplace, normalized, raw)
      if (wasImported) imported += 1
    } catch (err) {
      failed += 1
      await logSync(
        marketplace,
        'pull_orders',
        'failed',
        { raw },
        getErrorMessage(err),
      )
    }
  }

  await logSync(marketplace, 'pull_orders', 'success', {
    scanned: rawOrders.length,
    imported,
    failed,
  })

  return { scanned: rawOrders.length, imported, failed }
}

// ---------------------------------------------------------------------------
// Product creation — creating a brand-new listing on a channel, as opposed to
// pushInventoryFor* above which only update stock on an already-linked one.
// ---------------------------------------------------------------------------

export async function listCategoriesForMarketplace(
  marketplace: MarketplaceName,
  query: string,
): Promise<MarketplaceCategory[]> {
  const connection = await getActiveConnection(marketplace)
  if (!connection) throw new MarketplaceNotConnectedError(marketplace)
  const adapter = getAdapter(marketplace)
  const fresh = await ensureFreshConnection(connection)
  return adapter.listCategories(fresh, query)
}

export async function getCategoryAttributesForMarketplace(
  marketplace: MarketplaceName,
  categoryId: string,
): Promise<MarketplaceCategoryAttribute[]> {
  const connection = await getActiveConnection(marketplace)
  if (!connection) throw new MarketplaceNotConnectedError(marketplace)
  const adapter = getAdapter(marketplace)
  const fresh = await ensureFreshConnection(connection)
  return adapter.getCategoryAttributes(fresh, categoryId)
}

export async function pushNewProductToMarketplace(
  marketplace: MarketplaceName,
  productId: string,
  categoryId: string,
  attributeValues: MarketplaceCategoryAttributeAnswer[],
): Promise<{ externalProductId: string }> {
  const admin = getSupabaseAdminClient()
  const connection = await getActiveConnection(marketplace)
  if (!connection) throw new MarketplaceNotConnectedError(marketplace)

  const { data: product, error: productError } = await admin
    .from('products')
    .select('id, name, description, images')
    .eq('id', productId)
    .single()
  if (productError) throw productError

  const { data: variants, error: variantsError } = await admin
    .from('product_variants')
    .select(
      'id, sku, size, color, style, price_cents, inventory(quantity_available)',
    )
    .eq('product_id', productId)
    .eq('is_active', true)
  if (variantsError) throw variantsError
  if (variants.length === 0) {
    throw new Error('This product has no active variants to push.')
  }

  const adapter = getAdapter(marketplace)
  const fresh = await ensureFreshConnection(connection)

  try {
    const result = await adapter.createProduct(fresh, {
      name: product.name,
      description: product.description ?? '',
      images: product.images,
      categoryId,
      attributeValues,
      variants: variants.map((v) => ({
        variantId: v.id,
        sku: v.sku,
        size: v.size,
        color: v.color,
        style: v.style,
        priceCents: v.price_cents,
        quantityAvailable: v.inventory[0]?.quantity_available ?? 0,
      })),
    })

    const now = new Date().toISOString()
    const skuByVariantId = new Map(variants.map((v) => [v.id, v.sku]))
    for (const v of result.variants) {
      if (!v.externalVariantId) continue
      await admin.from('marketplace_product_mappings').upsert(
        {
          marketplace_connection_id: connection.id,
          variant_id: v.variantId,
          external_variant_id: v.externalVariantId,
          external_sku: skuByVariantId.get(v.variantId) ?? null,
          sync_status: 'synced',
          last_synced_at: now,
        },
        { onConflict: 'marketplace_connection_id,external_variant_id' },
      )
    }

    await logSync(marketplace, 'push_new_product', 'success', {
      productId,
      externalProductId: result.externalProductId,
      variantCount: result.variants.length,
    })
    return { externalProductId: result.externalProductId }
  } catch (err) {
    await logSync(
      marketplace,
      'push_new_product',
      'failed',
      { productId, categoryId },
      getErrorMessage(err),
    )
    throw err
  }
}

// ---------------------------------------------------------------------------
// Fulfillment status push
// ---------------------------------------------------------------------------

const FULFILLMENT_PUSH_STATUS: Partial<
  Record<string, 'shipped' | 'delivered'>
> = {
  in_transit: 'shipped',
  delivered: 'delivered',
}

/**
 * Tells the order's originating channel (if it came from one, and is still
 * connected) that it's shipped/delivered, so the platform doesn't keep
 * showing "unfulfilled" forever. Called after every shipment update (see
 * admin/orders.ts's upsertShipment); no-ops quietly for storefront/admin
 * orders or shipment statuses that aren't shipped/delivered yet, since
 * there's nothing meaningful to tell the platform before then.
 */
export async function pushFulfillmentUpdate(orderId: string): Promise<void> {
  const admin = getSupabaseAdminClient()

  const { data: order, error } = await admin
    .from('orders')
    .select('source, external_order_id')
    .eq('id', orderId)
    .single()
  if (error) throw error

  if (order.source === 'storefront' || order.source === 'admin') return
  if (!order.external_order_id) return
  if (!IMPLEMENTED_MARKETPLACES.includes(order.source)) return
  const marketplace = order.source

  const { data: shipment, error: shipmentError } = await admin
    .from('shipments')
    .select('carrier, tracking_number, status')
    .eq('order_id', orderId)
    .maybeSingle()
  if (shipmentError) throw shipmentError
  if (!shipment) return

  const pushStatus = FULFILLMENT_PUSH_STATUS[shipment.status]
  if (!pushStatus) return

  const connection = await getActiveConnection(marketplace)
  if (!connection) return

  const adapter = getAdapter(marketplace)
  try {
    const fresh = await ensureFreshConnection(connection)
    await adapter.updateFulfillment(fresh, {
      externalOrderId: order.external_order_id,
      carrier: shipment.carrier,
      trackingNumber: shipment.tracking_number,
      status: pushStatus,
    })
    await logSync(marketplace, 'push_fulfillment', 'success', {
      orderId,
      status: pushStatus,
    })
  } catch (err) {
    await logSync(
      marketplace,
      'push_fulfillment',
      'failed',
      { orderId, status: pushStatus },
      getErrorMessage(err),
    )
    throw err
  }
}

// ---------------------------------------------------------------------------
// Connecting to an already-existing listing (as opposed to createProduct
// above, which makes a brand-new one). Requires an exact match — same
// product title, same variant option values including letter case — the
// same rule the seller's existing Shopify-side sync app enforces, so a
// listing never gets silently connected to the wrong product.
// ---------------------------------------------------------------------------

function variantOptionValues(v: {
  size: string | null
  color: string | null
  style: string | null
}): string[] {
  return [v.size, v.color, v.style].filter((x): x is string => Boolean(x))
}

function optionValuesMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((value, i) => value === sortedB[i])
}

export async function connectExistingProductToMarketplace(
  marketplace: MarketplaceName,
  productId: string,
  externalProductId: string,
): Promise<{ connectedVariants: number }> {
  const admin = getSupabaseAdminClient()
  const connection = await getActiveConnection(marketplace)
  if (!connection) throw new MarketplaceNotConnectedError(marketplace)

  const { data: product, error: productError } = await admin
    .from('products')
    .select('id, name')
    .eq('id', productId)
    .single()
  if (productError) throw productError

  const { data: variants, error: variantsError } = await admin
    .from('product_variants')
    .select('id, sku, size, color, style')
    .eq('product_id', productId)
    .eq('is_active', true)
  if (variantsError) throw variantsError
  if (variants.length === 0) {
    throw new Error('This product has no active variants to connect.')
  }

  const adapter = getAdapter(marketplace)
  const fresh = await ensureFreshConnection(connection)

  try {
    const remote = await adapter.getProductByExternalId(
      fresh,
      externalProductId,
    )

    if (remote.name !== product.name) {
      throw new Error(
        `Title doesn't match exactly — ours: "${product.name}", theirs: "${remote.name}".`,
      )
    }

    const usedExternalIds = new Set<string>()
    const matches: {
      variantId: string
      externalVariantId: string
      externalSku: string | null
    }[] = []
    const unmatched: string[] = []

    for (const v of variants) {
      const ourValues = variantOptionValues(v)
      const match = remote.variants.find(
        (rv) =>
          !usedExternalIds.has(rv.externalVariantId) &&
          optionValuesMatch(ourValues, rv.optionValues),
      )
      if (!match) {
        const caseInsensitiveMatch = remote.variants.find((rv) =>
          optionValuesMatch(
            ourValues.map((x) => x.toLowerCase()),
            rv.optionValues.map((x) => x.toLowerCase()),
          ),
        )
        unmatched.push(
          caseInsensitiveMatch
            ? `${v.sku} (${ourValues.join('/')}) — theirs is "${caseInsensitiveMatch.optionValues.join('/')}", letter case must match exactly`
            : `${v.sku} (${ourValues.join('/') || 'no options'}) — no matching variant found`,
        )
        continue
      }
      usedExternalIds.add(match.externalVariantId)
      matches.push({
        variantId: v.id,
        externalVariantId: match.externalVariantId,
        externalSku: match.externalSku,
      })
    }

    if (unmatched.length > 0) {
      throw new Error(`Variant mismatch: ${unmatched.join('; ')}`)
    }

    const now = new Date().toISOString()
    for (const m of matches) {
      const { error: upsertError } = await admin
        .from('marketplace_product_mappings')
        .upsert(
          {
            marketplace_connection_id: connection.id,
            variant_id: m.variantId,
            external_variant_id: m.externalVariantId,
            external_sku: m.externalSku,
            sync_status: 'pending',
            last_synced_at: now,
          },
          { onConflict: 'marketplace_connection_id,external_variant_id' },
        )
      if (upsertError) throw upsertError
    }

    // Deliberately doesn't push inventory here — connecting only links the
    // product; inventory sync is a separate, explicit opt-in per channel
    // (see pushOneMapping's comment on why).

    await logSync(marketplace, 'connect_existing_product', 'success', {
      productId,
      externalProductId,
      connectedVariants: matches.length,
    })
    return { connectedVariants: matches.length }
  } catch (err) {
    await logSync(
      marketplace,
      'connect_existing_product',
      'failed',
      { productId, externalProductId },
      getErrorMessage(err),
    )
    throw err
  }
}

export interface AutoConnectByTitleResult {
  connected: {
    productId: string
    productName: string
    externalProductId: string
    connectedVariants: number
  }[]
  skipped: { productId: string; productName: string; reason: string }[]
}

/**
 * Auto-connects every currently-unlinked local product to a same-titled
 * listing on the platform, so staff only need to review the leftovers
 * instead of pasting in every external product id by hand. Delegates the
 * actual linking to connectExistingProductToMarketplace above so the
 * exact-match/variant rules stay in exactly one place — this only decides
 * which pairs are worth attempting (case-insensitively, since that's more
 * forgiving for a first pass; connectExistingProductToMarketplace still
 * enforces an exact, case-sensitive match and reports back if that fails).
 */
export async function autoConnectProductsByTitle(
  marketplace: MarketplaceName,
): Promise<AutoConnectByTitleResult> {
  const admin = getSupabaseAdminClient()
  const connection = await getActiveConnection(marketplace)
  if (!connection) throw new MarketplaceNotConnectedError(marketplace)

  const adapter = getAdapter(marketplace)
  const fresh = await ensureFreshConnection(connection)
  const remoteProducts = await adapter.listProducts(fresh)

  const remoteByTitle = new Map<string, typeof remoteProducts>()
  for (const p of remoteProducts) {
    const key = p.name.trim().toLowerCase()
    const bucket = remoteByTitle.get(key) ?? []
    bucket.push(p)
    remoteByTitle.set(key, bucket)
  }

  const { data: mappings, error: mappingsError } = await admin
    .from('marketplace_product_mappings')
    .select('variant_id')
    .eq('marketplace_connection_id', connection.id)
  if (mappingsError) throw mappingsError
  const linkedVariantIds = new Set(mappings.map((m) => m.variant_id))

  const { data: variants, error: variantsError } = await admin
    .from('product_variants')
    .select('id, product_id')
    .eq('is_active', true)
  if (variantsError) throw variantsError

  const linkedProductIds = new Set(
    variants.filter((v) => linkedVariantIds.has(v.id)).map((v) => v.product_id),
  )
  const unlinkedProductIds = Array.from(
    new Set(
      variants
        .filter((v) => !linkedProductIds.has(v.product_id))
        .map((v) => v.product_id),
    ),
  )

  const { data: products, error: productsError } =
    unlinkedProductIds.length > 0
      ? await admin
          .from('products')
          .select('id, name')
          .in('id', unlinkedProductIds)
      : { data: [], error: null }
  if (productsError) throw productsError

  const result: AutoConnectByTitleResult = { connected: [], skipped: [] }

  for (const product of products) {
    const matches = remoteByTitle.get(product.name.trim().toLowerCase()) ?? []
    if (matches.length === 0) {
      result.skipped.push({
        productId: product.id,
        productName: product.name,
        reason: 'No TikTok product with a matching title.',
      })
      continue
    }
    if (matches.length > 1) {
      result.skipped.push({
        productId: product.id,
        productName: product.name,
        reason: `${matches.length} TikTok products share this title — connect manually.`,
      })
      continue
    }

    try {
      const connectResult = await connectExistingProductToMarketplace(
        marketplace,
        product.id,
        matches[0].externalProductId,
      )
      result.connected.push({
        productId: product.id,
        productName: product.name,
        externalProductId: matches[0].externalProductId,
        connectedVariants: connectResult.connectedVariants,
      })
    } catch (err) {
      result.skipped.push({
        productId: product.id,
        productName: product.name,
        reason: getErrorMessage(err),
      })
    }
  }

  return result
}

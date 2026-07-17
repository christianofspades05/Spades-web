/**
 * The core orchestration layer every cron job / admin action goes through.
 * This file never imports a platform-specific client — only ./registry.ts
 * (which resolves a MarketplaceName to a MarketplaceAdapter) and the
 * MarketplaceAdapter interface. Adding Shopee/Lazada support later never
 * requires touching this file.
 */
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { getErrorMessage } from '#/lib/utils/errors'
import { getAdapter } from './registry'
import type { NormalizedOrder, SyncableMarketplace } from './types'
import { MarketplaceNotConnectedError } from './types'
import type { MarketplaceConnection, MarketplaceName } from '#/types/entities'

const MAX_ATTEMPTS = 3
const BASE_RETRY_DELAY_MS = 500

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
  if (existing) return false

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

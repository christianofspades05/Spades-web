/**
 * Shopee implementation of the MarketplaceAdapter contract (see ../types.ts).
 * This is the only file that should ever need to change if Shopee's API
 * shape changes — the sync engine only calls the interface.
 *
 * Every endpoint path and payload field name below follows Shopee Open
 * Platform v2's publicly documented conventions, but — same caveat as
 * ./client.ts — hasn't been exercised against a live or sandbox shop yet.
 * Treat `mapOrderToInternalFormat` especially as a first draft: once real
 * order payloads start flowing through pullOrders, compare them against the
 * field names read here and adjust. The full raw payload is always kept
 * (orders.platform_order_data), so nothing is lost even if a normalized
 * field comes through wrong or empty in the meantime.
 *
 * Same caveat applies, more so, to listCategories/getCategoryAttributes/
 * createProduct/updateFulfillment: Shopee's Product/Logistics APIs are
 * considerably more involved than inventory/order sync (category-specific
 * attributes, a separate image upload step, and shipping requires first
 * querying get_shipping_parameter to know what a given order's logistics
 * channel actually requires before calling ship_order). Expect the first
 * real "Push to Shopee" attempt to surface a field-name or shape mismatch —
 * check the response body (surfaced via sync_logs) against Shopee's own API
 * reference and adjust.
 */
import type { OrderShippingAddress } from '#/lib/checkout/shipping-address'
import type { MarketplaceConnection } from '#/types/entities'
import type {
  CreatedMarketplaceProduct,
  ImportedFulfillmentStatus,
  MarketplaceAdapter,
  MarketplaceCategory,
  MarketplaceCategoryAttribute,
  MarketplaceFulfillmentUpdate,
  MarketplaceProductDetail,
  MarketplaceProductSummary,
  NewMarketplaceProduct,
  NormalizedOrder,
  OAuthTokens,
} from '#/server/integrations/marketplaces/types'
import {
  buildAuthorizationUrl,
  callShopeeApi,
  exchangeAuthCode,
  refreshAccessToken,
} from './client'

/** `external_shop_id` is nullable at the DB level (not every connection row necessarily has one yet), but every signed Shopee call requires it — this narrows both it and the access token to non-null in one place instead of repeating the check per method. */
function requireCredentials(
  connection: MarketplaceConnection,
): { accessToken: string; shopId: string } {
  if (!connection.access_token_encrypted || !connection.external_shop_id) {
    throw new Error(
      'Shopee connection is missing its access token or shop id.',
    )
  }
  return {
    accessToken: connection.access_token_encrypted,
    shopId: connection.external_shop_id,
  }
}

async function toOAuthTokens(
  shopId: string,
  token: Awaited<ReturnType<typeof exchangeAuthCode>>,
): Promise<OAuthTokens> {
  // Best-effort, same as TikTok: don't block the whole connect flow if the
  // shop-name lookup fails for some reason — save the connection without a
  // name rather than refusing to connect at all.
  let shopName: string | undefined
  try {
    const info = await callShopeeApi<{ shop_name?: string }>({
      method: 'GET',
      path: '/api/v2/shop/get_shop_info',
      accessToken: token.access_token,
      shopId,
    })
    shopName = info.shop_name
  } catch {
    shopName = undefined
  }

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenExpiresAt: new Date(Date.now() + token.expire_in * 1000).toISOString(),
    shopId,
    shopName,
  }
}

interface ShopeeRecipientAddress {
  name?: string
  phone?: string
  full_address?: string
  district?: string
  city?: string
  state?: string
  region?: string
  zipcode?: string
}

interface ShopeeOrderItem {
  item_id: number
  item_name?: string
  item_sku?: string
  model_id?: number
  model_name?: string
  model_sku?: string
  model_quantity_purchased?: number
  model_discounted_price?: number
  model_original_price?: number
}

interface ShopeeOrder {
  order_sn: string
  create_time: number
  buyer_username?: string
  recipient_address?: ShopeeRecipientAddress
  item_list?: ShopeeOrderItem[]
  total_amount?: number
  estimated_shipping_fee?: number
  actual_shipping_fee?: number
  order_status?: string
  /** Present once a shipping document/tracking number has been generated for the order. */
  tracking_number?: string
  shipping_carrier?: string
}

/** Every status except UNPAID/CANCELLED/IN_CANCEL/TO_RETURN represents a completed sale on Shopee's side. */
const UNPAID_LIKE_STATUSES = new Set(['UNPAID', 'CANCELLED', 'IN_CANCEL'])

/** Maps Shopee's own order status onto our shipment lifecycle — mirrors the
 * same granularity TikTok Shop's adapter provides (awaiting shipment vs.
 * awaiting courier collection vs. in transit) instead of a single binary
 * fulfilled/unfulfilled flag. */
const SHOPEE_STATUS_TO_FULFILLMENT = new Map<string, ImportedFulfillmentStatus>(
  [
    ['READY_TO_SHIP', 'pending'],
    ['PROCESSED', 'packed'],
    ['SHIPPED', 'in_transit'],
    ['TO_CONFIRM_RECEIVE', 'in_transit'],
    ['COMPLETED', 'delivered'],
  ],
)

interface ShopeeCategoryNode {
  category_id: number
  parent_category_id: number
  original_category_name: string
  display_category_name?: string
  has_children: boolean
}

interface ShopeeAttributeValue {
  value_id: number
  original_value_name: string
}

interface ShopeeAttributeNode {
  attribute_id: number
  original_attribute_name: string
  is_mandatory: boolean
  attribute_value_list?: ShopeeAttributeValue[]
}

/** Downloads one of our own hosted product images and re-uploads it through Shopee's Media Space API, returning the `image_id` Shopee expects in a product's image list. */
async function uploadProductImage(
  accessToken: string,
  shopId: string,
  imageUrl: string,
): Promise<string> {
  const res = await fetch(imageUrl)
  if (!res.ok) {
    throw new Error(`Failed to download image for Shopee upload: ${imageUrl}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  const { image_info } = await callShopeeApi<{
    image_info: { image_id: string }
  }>({
    method: 'POST',
    path: '/api/v2/media_space/upload_image',
    accessToken,
    shopId,
    body: { image: buffer.toString('base64') },
  })
  return image_info.image_id
}

export const shopeeAdapter: MarketplaceAdapter = {
  marketplace: 'shopee',

  getAuthorizationUrl(state) {
    return buildAuthorizationUrl(state)
  },

  async exchangeCodeForTokens(code, shopId) {
    if (!shopId) {
      throw new Error(
        'Shopee token exchange requires shopId (from the callback redirect\'s shop_id query param).',
      )
    }
    const token = await exchangeAuthCode(code, shopId)
    return toOAuthTokens(shopId, token)
  },

  async refreshTokens(refreshToken, shopId) {
    if (!shopId) {
      throw new Error(
        'Shopee token refresh requires shopId (connection.external_shop_id).',
      )
    }
    const token = await refreshAccessToken(refreshToken, shopId)
    return toOAuthTokens(shopId, token)
  },

  /** Shopee's stock endpoint is keyed by item_id + (optional) model_id — quantity for a product with no variations is set directly on the item, but every product in this app has at least one variant row, so model_id is always sent. */
  async pushInventory(
    connection: MarketplaceConnection,
    externalProductId: string,
    externalVariantId: string,
    quantity: number,
  ) {
    const { accessToken, shopId } = requireCredentials(connection)
    await callShopeeApi({
      method: 'POST',
      path: '/api/v2/product/update_stock',
      accessToken,
      shopId,
      body: {
        item_id: Number(externalProductId),
        stock_list: [
          {
            model_id: Number(externalVariantId),
            seller_stock: [{ stock: quantity }],
          },
        ],
      },
    })
  },

  async pullOrders(connection: MarketplaceConnection, since: Date) {
    const { accessToken, shopId } = requireCredentials(connection)
    const sinceSeconds = Math.floor(since.getTime() / 1000)
    const nowSeconds = Math.floor(Date.now() / 1000)

    // get_order_list rejects any time_from/time_to span over 15 days
    // ("order.order_list_invalid_time") — fine for the routine cron's short
    // lookback, but a wider admin-triggered backfill (e.g. a 30-day recheck
    // for stale cancellations) needs the range split into sub-15-day
    // windows and queried one at a time.
    const MAX_WINDOW_SECONDS = 14 * 24 * 60 * 60
    const orderSns = new Set<string>()
    for (
      let windowStart = sinceSeconds;
      windowStart < nowSeconds;
      windowStart += MAX_WINDOW_SECONDS
    ) {
      const windowEnd = Math.min(
        windowStart + MAX_WINDOW_SECONDS,
        nowSeconds,
      )
      let cursor = ''
      do {
        const page = await callShopeeApi<{
          // Confirmed via a real empty-shop response: Shopee omits this
          // field entirely (rather than returning `[]`) when there's
          // nothing to list — every array field below has the same caveat.
          order_list?: { order_sn: string }[]
          more: boolean
          next_cursor: string
        }>({
          method: 'GET',
          path: '/api/v2/order/get_order_list',
          accessToken,
          shopId,
          query: {
            time_range_field: 'update_time',
            time_from: windowStart.toString(),
            time_to: windowEnd.toString(),
            page_size: '50',
            cursor,
          },
        })
        for (const o of page.order_list ?? []) orderSns.add(o.order_sn)
        cursor = page.more ? page.next_cursor : ''
      } while (cursor)
    }

    if (orderSns.size === 0) return []

    // get_order_detail caps out at 50 order_sn per call.
    const orderSnList = Array.from(orderSns)
    const orders: Record<string, unknown>[] = []
    for (let i = 0; i < orderSnList.length; i += 50) {
      const batch = orderSnList.slice(i, i + 50)
      const { order_list } = await callShopeeApi<{
        order_list?: ShopeeOrder[]
      }>({
        method: 'GET',
        path: '/api/v2/order/get_order_detail',
        accessToken,
        shopId,
        query: { order_sn_list: batch.join(',') },
      })
      orders.push(...((order_list ?? []) as unknown as Record<string, unknown>[]))
    }
    return orders
  },

  mapOrderToInternalFormat(platformOrderData): NormalizedOrder {
    const order = platformOrderData as unknown as ShopeeOrder
    const address = order.recipient_address ?? {}

    const shippingAddress: OrderShippingAddress = {
      email: '', // Shopee doesn't expose buyer email to sellers.
      recipientName: address.name ?? 'Shopee customer',
      phone: address.phone ?? '',
      region: address.region ?? address.state ?? '',
      province: address.state ?? '',
      city: address.city ?? '',
      barangay: address.district ?? '',
      postalCode: address.zipcode ?? null,
      addressLine1: address.full_address ?? '',
      addressLine2: null,
      landmark: null,
    }

    const items = (order.item_list ?? []).map((item) => ({
      externalVariantId: String(item.model_id ?? item.item_id),
      externalSku: item.model_sku ?? item.item_sku ?? null,
      productName: item.item_name ?? 'Shopee product',
      variantLabel: item.model_name ?? null,
      quantity: item.model_quantity_purchased ?? 1,
      unitPriceCents: Math.round(
        (item.model_discounted_price ?? item.model_original_price ?? 0) * 100,
      ),
    }))

    const totalCents = Math.round((order.total_amount ?? 0) * 100)
    const shippingCents = Math.round(
      (order.actual_shipping_fee ?? order.estimated_shipping_fee ?? 0) * 100,
    )
    const fulfillmentStatus = order.order_status
      ? SHOPEE_STATUS_TO_FULFILLMENT.get(order.order_status)
      : undefined

    return {
      externalOrderId: order.order_sn,
      placedAt: new Date(order.create_time * 1000).toISOString(),
      shippingAddress,
      items,
      subtotalCents: totalCents - shippingCents,
      shippingCents,
      totalCents,
      isPaid: !UNPAID_LIKE_STATUSES.has(order.order_status ?? ''),
      // IN_CANCEL is a cancellation still in progress on Shopee's side (not
      // guaranteed to finish that way) — only a finalized CANCELLED is
      // mirrored onto our own orders.status.
      isCancelled: order.order_status === 'CANCELLED',
      fulfillmentInfo: fulfillmentStatus
        ? {
            status: fulfillmentStatus,
            carrier: order.shipping_carrier ?? null,
            trackingNumber: order.tracking_number ?? null,
          }
        : null,
    }
  },

  async listCategories(
    connection: MarketplaceConnection,
    query: string,
  ): Promise<MarketplaceCategory[]> {
    const { accessToken, shopId } = requireCredentials(connection)
    // Shopee's category list has no keyword-search parameter — it returns
    // the whole tree, so filtering by `query` happens client-side here. For
    // a large tree this may want caching; left as a follow-up if it's slow.
    const { category_list } = await callShopeeApi<{
      category_list?: ShopeeCategoryNode[]
    }>({
      method: 'GET',
      path: '/api/v2/product/get_category',
      accessToken,
      shopId,
    })
    const normalized = query.trim().toLowerCase()
    return (category_list ?? [])
      .filter((c) => !c.has_children)
      .filter((c) =>
        normalized
          ? (c.display_category_name ?? c.original_category_name)
              .toLowerCase()
              .includes(normalized)
          : true,
      )
      .map((c) => ({
        id: String(c.category_id),
        name: c.display_category_name ?? c.original_category_name,
        isLeaf: true,
      }))
  },

  async getCategoryAttributes(
    connection: MarketplaceConnection,
    categoryId: string,
  ): Promise<MarketplaceCategoryAttribute[]> {
    const { accessToken, shopId } = requireCredentials(connection)
    const { attribute_list } = await callShopeeApi<{
      attribute_list?: ShopeeAttributeNode[]
    }>({
      method: 'GET',
      path: '/api/v2/product/get_attributes',
      accessToken,
      shopId,
      query: { category_id: categoryId },
    })
    return (attribute_list ?? []).map((a) => ({
      id: String(a.attribute_id),
      name: a.original_attribute_name,
      required: a.is_mandatory,
      values: a.attribute_value_list?.length
        ? a.attribute_value_list.map((v) => ({
            id: String(v.value_id),
            name: v.original_value_name,
          }))
        : null,
    }))
  },

  async createProduct(
    connection: MarketplaceConnection,
    input: NewMarketplaceProduct,
  ): Promise<CreatedMarketplaceProduct> {
    const { accessToken, shopId } = requireCredentials(connection)

    const imageIds = await Promise.all(
      input.images.map((url) => uploadProductImage(accessToken, shopId, url)),
    )

    const response = await callShopeeApi<{
      item_id: number
      model?: { model_id: number; model_sku: string }[]
    }>({
      method: 'POST',
      path: '/api/v2/product/add_item',
      accessToken,
      shopId,
      body: {
        category_id: Number(input.categoryId),
        item_name: input.name,
        description: input.description,
        image: { image_id_list: imageIds },
        attribute_list: input.attributeValues.map((a) => ({
          attribute_id: Number(a.attributeId),
          attribute_value_list: a.valueId
            ? [{ value_id: Number(a.valueId) }]
            : [{ original_value_name: a.value ?? '' }],
        })),
        // Shopee requires a `tier_variation`/`model` list for multi-variant
        // items rather than a flat sku array like TikTok's — this sends a
        // single "Variant" tier with one option per variant, which covers
        // the common case (one variation axis: size, or color, etc.).
        // Products needing two variation axes (e.g. size AND color) will
        // need this expanded once exercised against a real product.
        tier_variation: [
          {
            name: 'Variant',
            option_list: input.variants.map((v) => ({
              option: [v.size, v.color, v.style].filter(Boolean).join(' / '),
            })),
          },
        ],
        model: input.variants.map((v) => ({
          tier_index: [input.variants.indexOf(v)],
          model_sku: v.sku,
          original_price: v.priceCents / 100,
          normal_stock: v.quantityAvailable,
        })),
      },
    })

    const externalVariantByIndex = new Map(
      (response.model ?? []).map((m, i) => [i, m]),
    )
    return {
      externalProductId: String(response.item_id),
      variants: input.variants.map((v, i) => ({
        variantId: v.variantId,
        externalVariantId: String(
          externalVariantByIndex.get(i)?.model_id ?? '',
        ),
      })),
    }
  },

  async updateFulfillment(
    connection: MarketplaceConnection,
    update: MarketplaceFulfillmentUpdate,
  ): Promise<void> {
    if (update.status === 'delivered') {
      // Shopee tracks delivery itself once a package has a real tracking
      // number moving through its logistics partner — there's no
      // documented seller-side "mark delivered" call, so there's nothing to
      // push for this status (same as TikTok's adapter).
      return
    }

    const { accessToken, shopId } = requireCredentials(connection)

    // Shopee requires querying what a given order's logistics channel
    // actually needs (pickup vs. dropoff, address/date requirements) before
    // calling ship_order — this sends the minimal dropoff-style request,
    // which is the common case for a self-arranged/3PL shipment with an
    // existing tracking number. Pickup-required channels will need this
    // expanded once exercised against a real order.
    await callShopeeApi({
      method: 'POST',
      path: '/api/v2/logistics/ship_order',
      accessToken,
      shopId,
      body: {
        order_sn: update.externalOrderId,
        dropoff: {
          tracking_number: update.trackingNumber ?? undefined,
        },
      },
    })
  },

  async getProductByExternalId(
    connection: MarketplaceConnection,
    externalProductId: string,
  ): Promise<MarketplaceProductDetail> {
    const { accessToken, shopId } = requireCredentials(connection)
    const itemId = Number(externalProductId)

    const [baseInfo, modelList] = await Promise.all([
      callShopeeApi<{
        item_list?: { item_id: number; item_name: string }[]
      }>({
        method: 'GET',
        path: '/api/v2/product/get_item_base_info',
        accessToken,
        shopId,
        query: { item_id_list: String(itemId) },
      }),
      callShopeeApi<{
        model?: { model_id: number; model_sku?: string; tier_index: number[] }[]
        tier_variation?: { option_list: { option: string }[] }[]
      }>({
        method: 'GET',
        path: '/api/v2/product/get_model_list',
        accessToken,
        shopId,
        query: { item_id: String(itemId) },
      }),
    ])

    return {
      name: (baseInfo.item_list ?? [])[0]?.item_name ?? '',
      variants: (modelList.model ?? []).map((m) => ({
        externalVariantId: String(m.model_id),
        externalSku: m.model_sku ?? null,
        optionValues: m.tier_index.map(
          (optionIdx, tierIdx) =>
            modelList.tier_variation?.[tierIdx]?.option_list[optionIdx]
              ?.option ?? '',
        ),
      })),
    }
  },

  /**
   * Not exercised against a live shop yet (see the file-level caveat) —
   * get_item_list only returns item ids/status, not names, so this makes a
   * second call (get_item_base_info) to fill them in. If titles come back
   * empty, check the real response body (surfaced via sync_logs on
   * failure) against Shopee's reference and adjust the field names below.
   */
  async listProducts(
    connection: MarketplaceConnection,
  ): Promise<MarketplaceProductSummary[]> {
    const { accessToken, shopId } = requireCredentials(connection)

    const itemIds: number[] = []
    let offset = 0
    let hasNext = true
    while (hasNext) {
      const page = await callShopeeApi<{
        item?: { item_id: number }[]
        has_next_page?: boolean
        next_offset: number
      }>({
        method: 'GET',
        path: '/api/v2/product/get_item_list',
        accessToken,
        shopId,
        query: {
          offset: offset.toString(),
          page_size: '100',
          item_status: 'NORMAL',
        },
      })
      itemIds.push(...(page.item ?? []).map((i) => i.item_id))
      hasNext = page.has_next_page ?? false
      offset = page.next_offset
    }

    if (itemIds.length === 0) return []

    const products: MarketplaceProductSummary[] = []
    for (let i = 0; i < itemIds.length; i += 50) {
      const batch = itemIds.slice(i, i + 50)
      const { item_list } = await callShopeeApi<{
        item_list?: { item_id: number; item_name?: string }[]
      }>({
        method: 'GET',
        path: '/api/v2/product/get_item_base_info',
        accessToken,
        shopId,
        query: { item_id_list: batch.join(',') },
      })
      for (const item of item_list ?? []) {
        products.push({
          externalProductId: String(item.item_id),
          name: item.item_name ?? '',
        })
      }
    }
    return products
  },
}

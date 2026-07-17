/**
 * TikTok Shop implementation of the MarketplaceAdapter contract (see
 * ../types.ts). This is the only file that should ever need to change if
 * TikTok's API shape changes — the sync engine only calls the interface.
 *
 * The order/inventory endpoint paths and payload field names below follow
 * TikTok Shop's documented "202309" API version conventions, but haven't
 * been exercised against a live shop (see the caveat at the top of
 * ./client.ts). Treat `mapOrderToInternalFormat` especially as a first draft
 * — once real order payloads start flowing through pullOrders, compare them
 * against the field names read here and adjust. The full raw payload is
 * always kept (orders.platform_order_data), so nothing is lost even if a
 * normalized field comes through wrong or empty in the meantime.
 *
 * Same caveat applies, more so, to listCategories/getCategoryAttributes/
 * createProduct/updateFulfillment: TikTok's Product/Fulfillment/Logistics
 * APIs are considerably more involved than inventory/order sync (category
 * trees, per-category required attributes, a separate image upload step,
 * package-level shipping), and the exact field names below are a best-effort
 * reconstruction, not something exercised against a live shop. Expect the
 * first real "Push to TikTok" attempt to surface a field-name or shape
 * mismatch — check the response body (surfaced via sync_logs) against
 * Partner Center's own API reference and adjust.
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
  callTikTokApi,
  exchangeAuthCode,
  refreshAccessToken,
} from './client'

interface TikTokAuthorizedShop {
  id: string
  name?: string
  cipher: string
}

/**
 * TikTok requires a `shop_cipher` on top of the shop id for every signed
 * request — a separate opaque value fetched from this endpoint after OAuth,
 * not the same as the shop id or open_id (reusing either in its place fails
 * every call with "Invalid shop_cipher", error code 106011). This app
 * assumes one authorized shop per connection (see sync-engine.ts's comment
 * on that same assumption) and just takes the first one returned.
 */
async function getAuthorizedShops(
  accessToken: string,
): Promise<TikTokAuthorizedShop[]> {
  const { shops } = await callTikTokApi<{ shops: TikTokAuthorizedShop[] }>({
    method: 'GET',
    path: '/authorization/202309/shops',
    accessToken,
  })
  return shops
}

async function toOAuthTokens(
  token: Awaited<ReturnType<typeof exchangeAuthCode>>,
): Promise<OAuthTokens> {
  // Best-effort: if the app/token doesn't (yet) have whatever permission
  // this specific endpoint needs, don't block the whole connect flow over
  // it — save the connection without a shop_cipher rather than refusing to
  // connect at all. Every call that actually needs shop_cipher will still
  // fail on its own and log to sync_logs, which is a much easier thing to
  // debug than never getting connected in the first place.
  let shop: TikTokAuthorizedShop | undefined
  try {
    shop = (await getAuthorizedShops(token.access_token)).at(0)
  } catch {
    shop = undefined
  }

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenExpiresAt: new Date(
      Date.now() + token.access_token_expire_in * 1000,
    ).toISOString(),
    shopId: shop?.id ?? token.open_id ?? '',
    shopName: shop?.name ?? token.seller_name,
    shopCipher: shop?.cipher,
  }
}

interface TikTokRecipientAddress {
  name?: string
  phone_number?: string
  full_address?: string
  address_detail?: string
  address_line1?: string
  address_line2?: string
  district?: string
  town?: string
  city?: string
  state?: string
  region_code?: string
  zipcode?: string
}

interface TikTokLineItem {
  sku_id: string
  seller_sku?: string
  product_name?: string
  sku_name?: string
  sale_price?: string
  original_price?: string
}

interface TikTokOrder {
  id: string
  create_time: number
  buyer_email?: string
  recipient_address?: TikTokRecipientAddress
  line_items?: TikTokLineItem[]
  payment?: {
    total_amount?: string
    shipping_fee?: string
    sub_total?: string
  }
  status?: string
  /** Present once the seller arranges shipment, whether directly in TikTok
   * Seller Center or via us — confirmed against a live shipped order's raw
   * response (unlike most of the rest of this file, this one's verified). */
  tracking_number?: string
  shipping_provider?: string
}

const PAID_STATUSES = new Set([
  'AWAITING_SHIPMENT',
  'AWAITING_COLLECTION',
  'PARTIALLY_SHIPPING',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
])

/** Maps TikTok's own order status onto our shipment lifecycle, so the
 * admin Orders page can show the same granularity TikTok Seller Center
 * does (awaiting shipment vs. awaiting courier collection vs. in transit)
 * instead of a single binary fulfilled/unfulfilled flag. A tracking number
 * can exist before the courier actually collects the parcel (right after
 * staff prints a label) — this is why AWAITING_COLLECTION maps to 'packed',
 * not something that reads as fulfilled. */
const TIKTOK_STATUS_TO_FULFILLMENT = new Map<string, ImportedFulfillmentStatus>(
  [
    ['AWAITING_SHIPMENT', 'pending'],
    ['AWAITING_COLLECTION', 'packed'],
    ['PARTIALLY_SHIPPING', 'in_transit'],
    ['IN_TRANSIT', 'in_transit'],
    ['DELIVERED', 'delivered'],
    ['COMPLETED', 'delivered'],
  ],
)

function centsFromAmountString(amount: string | undefined): number {
  if (!amount) return 0
  return Math.round(Number.parseFloat(amount) * 100)
}

interface TikTokCategoryNode {
  id: string
  local_display_name?: string
  name?: string
  is_leaf?: boolean
}

interface TikTokCategoryAttributeValue {
  id: string
  name: string
}

interface TikTokCategoryAttributeNode {
  id: string
  name: string
  is_required?: boolean
  values?: TikTokCategoryAttributeValue[]
}

interface TikTokShippingProvider {
  id: string
  name: string
}

interface TikTokPackage {
  id: string
}

/** Downloads one of our own hosted product images and re-uploads it through TikTok's Image Upload API, returning the `uri` TikTok expects in a product's main_images. */
async function uploadProductImage(
  accessToken: string,
  shopCipher: string | undefined,
  imageUrl: string,
): Promise<string> {
  const res = await fetch(imageUrl)
  if (!res.ok) {
    throw new Error(`Failed to download image for TikTok upload: ${imageUrl}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  const { uri } = await callTikTokApi<{ uri: string }>({
    method: 'POST',
    path: '/product/202309/images/upload',
    accessToken,
    shopCipher,
    body: {
      data: buffer.toString('base64'),
      use_case: 'MAIN_IMAGE',
    },
  })
  return uri
}

/** TikTok's fulfillment API wants a shipping_provider_id, not a free-text carrier name — this fuzzy-matches our shipment's carrier string against TikTok's provider list by name. Returns undefined (rather than throwing) on no match, since a shipment update shouldn't fail outright just because the carrier name doesn't line up exactly. */
async function findShippingProviderId(
  accessToken: string,
  shopCipher: string | undefined,
  carrier: string | null,
): Promise<string | undefined> {
  if (!carrier) return undefined
  const { shipping_providers } = await callTikTokApi<{
    shipping_providers: TikTokShippingProvider[]
  }>({
    method: 'GET',
    path: '/logistics/202309/shipping_providers',
    accessToken,
    shopCipher,
  })
  const normalized = carrier.trim().toLowerCase()
  return shipping_providers.find(
    (p) => p.name.trim().toLowerCase() === normalized,
  )?.id
}

export const tiktokShopAdapter: MarketplaceAdapter = {
  marketplace: 'tiktok_shop',

  getAuthorizationUrl(state) {
    return buildAuthorizationUrl(state)
  },

  async exchangeCodeForTokens(code) {
    const token = await exchangeAuthCode(code)
    return toOAuthTokens(token)
  },

  async refreshTokens(refreshToken) {
    const token = await refreshAccessToken(refreshToken)
    return toOAuthTokens(token)
  },

  async pushInventory(
    connection: MarketplaceConnection,
    externalVariantId: string,
    quantity: number,
  ) {
    if (!connection.access_token_encrypted) {
      throw new Error('TikTok Shop connection has no access token.')
    }
    await callTikTokApi({
      method: 'POST',
      path: '/product/202309/inventory/update',
      accessToken: connection.access_token_encrypted,
      shopCipher: connection.shop_cipher ?? undefined,
      body: {
        skus: [
          {
            id: externalVariantId,
            stock_infos: [
              {
                available_stock: quantity,
              },
            ],
          },
        ],
      },
    })
  },

  async pullOrders(connection: MarketplaceConnection, since: Date) {
    if (!connection.access_token_encrypted) {
      throw new Error('TikTok Shop connection has no access token.')
    }
    const sinceSeconds = Math.floor(since.getTime() / 1000)

    const orders: Record<string, unknown>[] = []
    let pageToken: string | undefined
    do {
      const page = await callTikTokApi<{
        orders: TikTokOrder[]
        next_page_token?: string
      }>({
        method: 'POST',
        path: '/order/202309/orders/search',
        accessToken: connection.access_token_encrypted,
        shopCipher: connection.shop_cipher ?? undefined,
        query: {
          page_size: '50',
          ...(pageToken ? { page_token: pageToken } : {}),
        },
        body: {
          // update_time (not create_time) so this also catches orders
          // placed well before the lookback window but updated within it —
          // e.g. tracking added today on an order placed 3 days ago. A pure
          // create_time filter would never even fetch that order again.
          update_time_ge: sinceSeconds,
        },
      })
      orders.push(...(page.orders as unknown as Record<string, unknown>[]))
      pageToken = page.next_page_token
    } while (pageToken)

    return orders
  },

  mapOrderToInternalFormat(platformOrderData): NormalizedOrder {
    const order = platformOrderData as unknown as TikTokOrder
    const address = order.recipient_address ?? {}

    const shippingAddress: OrderShippingAddress = {
      email: order.buyer_email ?? '',
      recipientName: address.name ?? 'TikTok Shop customer',
      phone: address.phone_number ?? '',
      region: address.region_code ?? address.state ?? '',
      province: address.state ?? '',
      city: address.city ?? address.town ?? '',
      barangay: address.district ?? '',
      postalCode: address.zipcode ?? null,
      addressLine1:
        address.address_line1 ??
        address.address_detail ??
        address.full_address ??
        '',
      addressLine2: address.address_line2 ?? null,
      landmark: null,
    }

    const items = (order.line_items ?? []).map((item) => ({
      externalVariantId: item.sku_id,
      externalSku: item.seller_sku ?? null,
      productName: item.product_name ?? 'TikTok Shop product',
      variantLabel: item.sku_name ?? null,
      quantity: 1, // TikTok returns one line_item per unit, not a quantity field.
      unitPriceCents: centsFromAmountString(
        item.sale_price ?? item.original_price,
      ),
    }))

    const subtotalCents = centsFromAmountString(order.payment?.sub_total)
    const shippingCents = centsFromAmountString(order.payment?.shipping_fee)
    const totalCents = centsFromAmountString(order.payment?.total_amount)
    const fulfillmentStatus = order.status
      ? TIKTOK_STATUS_TO_FULFILLMENT.get(order.status)
      : undefined

    return {
      externalOrderId: order.id,
      placedAt: new Date(order.create_time * 1000).toISOString(),
      shippingAddress,
      items,
      subtotalCents: subtotalCents || totalCents - shippingCents,
      shippingCents,
      totalCents,
      isPaid: PAID_STATUSES.has(order.status ?? ''),
      fulfillmentInfo: fulfillmentStatus
        ? {
            status: fulfillmentStatus,
            carrier: order.shipping_provider ?? null,
            trackingNumber: order.tracking_number ?? null,
          }
        : null,
    }
  },

  async listCategories(
    connection: MarketplaceConnection,
    query: string,
  ): Promise<MarketplaceCategory[]> {
    if (!connection.access_token_encrypted) {
      throw new Error('TikTok Shop connection has no access token.')
    }
    const { categories } = await callTikTokApi<{
      categories: TikTokCategoryNode[]
    }>({
      method: 'GET',
      path: '/product/202309/categories',
      accessToken: connection.access_token_encrypted,
      shopCipher: connection.shop_cipher ?? undefined,
      query: { keyword: query },
    })
    return categories
      .filter((c) => c.is_leaf)
      .map((c) => ({
        id: c.id,
        name: c.local_display_name ?? c.name ?? c.id,
        isLeaf: true,
      }))
  },

  async getCategoryAttributes(
    connection: MarketplaceConnection,
    categoryId: string,
  ): Promise<MarketplaceCategoryAttribute[]> {
    if (!connection.access_token_encrypted) {
      throw new Error('TikTok Shop connection has no access token.')
    }
    const { attributes } = await callTikTokApi<{
      attributes: TikTokCategoryAttributeNode[]
    }>({
      method: 'GET',
      path: `/product/202309/categories/${categoryId}/attributes`,
      accessToken: connection.access_token_encrypted,
      shopCipher: connection.shop_cipher ?? undefined,
    })
    return attributes.map((a) => ({
      id: a.id,
      name: a.name,
      required: a.is_required ?? false,
      values: a.values?.length
        ? a.values.map((v) => ({ id: v.id, name: v.name }))
        : null,
    }))
  },

  async createProduct(
    connection: MarketplaceConnection,
    input: NewMarketplaceProduct,
  ): Promise<CreatedMarketplaceProduct> {
    if (!connection.access_token_encrypted) {
      throw new Error('TikTok Shop connection has no access token.')
    }
    const accessToken = connection.access_token_encrypted
    const shopCipher = connection.shop_cipher ?? undefined

    const imageUris = await Promise.all(
      input.images.map((url) =>
        uploadProductImage(accessToken, shopCipher, url),
      ),
    )

    const response = await callTikTokApi<{
      product_id: string
      skus: { id: string; seller_sku: string }[]
    }>({
      method: 'POST',
      path: '/product/202309/products',
      accessToken,
      shopCipher,
      body: {
        category_id: input.categoryId,
        product_name: input.name,
        description: input.description,
        main_images: imageUris.map((uri) => ({ uri })),
        product_attributes: input.attributeValues.map((a) => ({
          id: a.attributeId,
          values: a.valueId ? [{ id: a.valueId }] : [{ name: a.value ?? '' }],
        })),
        skus: input.variants.map((v) => ({
          seller_sku: v.sku,
          sales_attributes: [
            v.size ? { attribute_name: 'Size', attribute_value: v.size } : null,
            v.color
              ? { attribute_name: 'Color', attribute_value: v.color }
              : null,
            v.style
              ? { attribute_name: 'Style', attribute_value: v.style }
              : null,
          ].filter(
            (a): a is { attribute_name: string; attribute_value: string } =>
              a !== null,
          ),
          price: { amount: (v.priceCents / 100).toFixed(2), currency: 'PHP' },
          inventory: [{ quantity: v.quantityAvailable }],
        })),
      },
    })

    const externalVariantBySku = new Map(
      response.skus.map((s) => [s.seller_sku, s.id]),
    )
    return {
      externalProductId: response.product_id,
      variants: input.variants.map((v) => ({
        variantId: v.variantId,
        externalVariantId: externalVariantBySku.get(v.sku) ?? '',
      })),
    }
  },

  async updateFulfillment(
    connection: MarketplaceConnection,
    update: MarketplaceFulfillmentUpdate,
  ): Promise<void> {
    if (!connection.access_token_encrypted) {
      throw new Error('TikTok Shop connection has no access token.')
    }
    const accessToken = connection.access_token_encrypted
    const shopCipher = connection.shop_cipher ?? undefined

    if (update.status === 'delivered') {
      // TikTok tracks delivery itself once a package carries a real tracking
      // number — there's no documented seller-side "mark delivered" call, so
      // there's nothing to push for this status.
      return
    }

    const { packages } = await callTikTokApi<{ packages: TikTokPackage[] }>({
      method: 'GET',
      path: `/fulfillment/202309/orders/${update.externalOrderId}/packages`,
      accessToken,
      shopCipher,
    })
    const packageId = packages[0]?.id
    if (!packageId) {
      throw new Error(
        `No TikTok package found for order ${update.externalOrderId}.`,
      )
    }

    const shippingProviderId = await findShippingProviderId(
      accessToken,
      shopCipher,
      update.carrier,
    )

    await callTikTokApi({
      method: 'POST',
      path: `/fulfillment/202309/packages/${packageId}/ship`,
      accessToken,
      shopCipher,
      body: {
        tracking_number: update.trackingNumber ?? undefined,
        shipping_provider_id: shippingProviderId,
      },
    })
  },

  async getProductByExternalId(
    connection: MarketplaceConnection,
    externalProductId: string,
  ): Promise<MarketplaceProductDetail> {
    if (!connection.access_token_encrypted) {
      throw new Error('TikTok Shop connection has no access token.')
    }
    const response = await callTikTokApi<{
      title?: string
      skus?: {
        id: string
        seller_sku?: string
        sales_attributes?: { value_name?: string }[]
      }[]
    }>({
      method: 'GET',
      path: `/product/202309/products/${externalProductId}`,
      accessToken: connection.access_token_encrypted,
      shopCipher: connection.shop_cipher ?? undefined,
    })

    return {
      name: response.title ?? '',
      variants: (response.skus ?? []).map((sku) => ({
        externalVariantId: sku.id,
        externalSku: sku.seller_sku ?? null,
        optionValues: (sku.sales_attributes ?? [])
          .map((a) => a.value_name)
          .filter((v): v is string => Boolean(v)),
      })),
    }
  },

  /**
   * Not exercised against a live shop yet (see the file-level caveat) —
   * TikTok's product search response shape is a best-effort reconstruction
   * from their docs. If titles come back empty, check the real response body
   * (surfaced via sync_logs on failure, or add a temporary debug log here)
   * against Partner Center's reference and adjust the field names below.
   */
  async listProducts(
    connection: MarketplaceConnection,
  ): Promise<MarketplaceProductSummary[]> {
    if (!connection.access_token_encrypted) {
      throw new Error('TikTok Shop connection has no access token.')
    }

    const products: MarketplaceProductSummary[] = []
    let pageToken: string | undefined
    do {
      const page = await callTikTokApi<{
        products?: { id: string; title?: string; status?: string }[]
        next_page_token?: string
      }>({
        method: 'POST',
        path: '/product/202309/products/search',
        accessToken: connection.access_token_encrypted,
        shopCipher: connection.shop_cipher ?? undefined,
        query: {
          page_size: '100',
          ...(pageToken ? { page_token: pageToken } : {}),
        },
        body: {},
      })
      for (const p of page.products ?? []) {
        products.push({ externalProductId: p.id, name: p.title ?? '' })
      }
      pageToken = page.next_page_token
    } while (pageToken)

    return products
  },
}

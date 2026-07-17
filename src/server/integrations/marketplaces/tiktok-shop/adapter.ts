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
 */
import type { OrderShippingAddress } from '#/lib/checkout/shipping-address'
import type { MarketplaceConnection } from '#/types/entities'
import type {
  MarketplaceAdapter,
  NormalizedOrder,
  OAuthTokens,
} from '#/server/integrations/marketplaces/types'
import {
  buildAuthorizationUrl,
  callTikTokApi,
  exchangeAuthCode,
  refreshAccessToken,
} from './client'

function toOAuthTokens(
  token: Awaited<ReturnType<typeof exchangeAuthCode>>,
): OAuthTokens {
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenExpiresAt: new Date(
      Date.now() + token.access_token_expire_in * 1000,
    ).toISOString(),
    shopId: token.open_id ?? '',
    shopName: token.seller_name,
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
}

const PAID_STATUSES = new Set([
  'AWAITING_SHIPMENT',
  'AWAITING_COLLECTION',
  'PARTIALLY_SHIPPING',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
])

function centsFromAmountString(amount: string | undefined): number {
  if (!amount) return 0
  return Math.round(Number.parseFloat(amount) * 100)
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
      shopCipher: connection.external_shop_id ?? undefined,
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
        shopCipher: connection.external_shop_id ?? undefined,
        query: {
          page_size: '50',
          ...(pageToken ? { page_token: pageToken } : {}),
        },
        body: {
          create_time_ge: sinceSeconds,
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

    return {
      externalOrderId: order.id,
      placedAt: new Date(order.create_time * 1000).toISOString(),
      shippingAddress,
      items,
      subtotalCents: subtotalCents || totalCents - shippingCents,
      shippingCents,
      totalCents,
      isPaid: PAID_STATUSES.has(order.status ?? ''),
    }
  },
}

/**
 * The contract every marketplace integration implements. The sync engine
 * (./sync-engine.ts) only ever calls methods on this interface — it never
 * imports a specific platform's client directly, so adding Shopee/Lazada
 * later means writing one new file that implements this, not touching the
 * engine or the admin UI.
 */
import type { OrderShippingAddress } from '#/lib/checkout/shipping-address'
import type { MarketplaceConnection, MarketplaceName } from '#/types/entities'

/** MarketplaceName minus 'other' — every marketplace an adapter can actually implement doubles as a valid orders.source value. 'other' is a data-entry catch-all, never something the sync engine connects to. */
export type SyncableMarketplace = Exclude<MarketplaceName, 'other'>

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  /** ISO timestamp. */
  tokenExpiresAt: string
  shopId: string
  shopName?: string
}

export interface NormalizedOrderItem {
  /** The platform's own variant/SKU identifier — resolved to one of our
   *  variants via marketplace_product_mappings.external_variant_id. */
  externalVariantId: string
  externalSku: string | null
  productName: string
  variantLabel: string | null
  quantity: number
  unitPriceCents: number
}

/** What every platform's raw order shape gets normalized into before it becomes one of our `orders` rows. */
export interface NormalizedOrder {
  externalOrderId: string
  placedAt: string
  shippingAddress: OrderShippingAddress
  items: NormalizedOrderItem[]
  subtotalCents: number
  shippingCents: number
  totalCents: number
  /** True if the platform has already collected payment (the normal case —
   *  we're importing a completed sale, not taking payment ourselves). */
  isPaid: boolean
}

export interface MarketplaceAdapter {
  readonly marketplace: MarketplaceName

  /** Builds the URL to send the staff member to in order to authorize this app on the platform. */
  getAuthorizationUrl: (state: string) => string

  /** Exchanges the `code` param from the OAuth callback redirect for real tokens. */
  exchangeCodeForTokens: (code: string) => Promise<OAuthTokens>

  /** Uses a still-valid refresh token to get a new access token before the old one expires. */
  refreshTokens: (refreshToken: string) => Promise<OAuthTokens>

  /** Pushes our current stock count for one variant to the platform. */
  pushInventory: (
    connection: MarketplaceConnection,
    externalVariantId: string,
    quantity: number,
  ) => Promise<void>

  /** Fetches raw order objects created/updated on the platform since `since`. */
  pullOrders: (
    connection: MarketplaceConnection,
    since: Date,
  ) => Promise<Record<string, unknown>[]>

  /** Normalizes one raw platform order into our internal shape. */
  mapOrderToInternalFormat: (
    platformOrderData: Record<string, unknown>,
  ) => NormalizedOrder
}

export class MarketplaceNotConnectedError extends Error {
  constructor(marketplace: MarketplaceName) {
    super(`${marketplace} is not connected.`)
    this.name = 'MarketplaceNotConnectedError'
  }
}

export class AdapterNotImplementedError extends Error {
  constructor(marketplace: MarketplaceName) {
    super(`The ${marketplace} integration isn't built yet.`)
    this.name = 'AdapterNotImplementedError'
  }
}

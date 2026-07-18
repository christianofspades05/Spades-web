/**
 * The contract every marketplace integration implements. The sync engine
 * (./sync-engine.ts) only ever calls methods on this interface — it never
 * imports a specific platform's client directly, so adding Shopee/Lazada
 * later means writing one new file that implements this, not touching the
 * engine or the admin UI.
 */
import type { OrderShippingAddress } from '#/lib/checkout/shipping-address'
import type {
  MarketplaceConnection,
  MarketplaceName,
  ShipmentStatus,
} from '#/types/entities'

/** The subset of our shipment lifecycle a platform's own order status can drive automatically — excludes states like 'failed'/'returned_to_sender' that only make sense from a manual staff action or a delivery exception, not a normal status progression. */
export type ImportedFulfillmentStatus = Exclude<
  ShipmentStatus,
  'failed' | 'returned_to_sender' | 'out_for_delivery'
>

/** MarketplaceName minus 'other' — every marketplace an adapter can actually implement doubles as a valid orders.source value. 'other' is a data-entry catch-all, never something the sync engine connects to. */
export type SyncableMarketplace = Exclude<MarketplaceName, 'other'>

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  /** ISO timestamp. */
  tokenExpiresAt: string
  shopId: string
  shopName?: string
  /** An opaque per-shop value some platforms (TikTok Shop) require on every signed request in addition to shopId — not every adapter needs this. */
  shopCipher?: string
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
  /** Reflects wherever the order actually is in the platform's own fulfillment lifecycle (awaiting shipment, awaiting courier collection, in transit, delivered) — not just whether a tracking number exists, since a platform can assign one before the courier actually collects the parcel. Null if the platform gave us nothing to go on. */
  fulfillmentInfo: {
    status: ImportedFulfillmentStatus
    carrier: string | null
    trackingNumber: string | null
  } | null
}

/** A category the platform requires every product to be filed under. Only leaf categories (isLeaf) are selectable when creating a product. */
export interface MarketplaceCategory {
  id: string
  name: string
  isLeaf: boolean
}

export interface MarketplaceCategoryAttributeValue {
  id: string
  name: string
}

/** A field the platform requires (or allows) once a category is chosen — e.g. "Material", "Color". If `values` is set, the attribute must be answered from that fixed list rather than free text. */
export interface MarketplaceCategoryAttribute {
  id: string
  name: string
  required: boolean
  values: MarketplaceCategoryAttributeValue[] | null
}

export interface MarketplaceCategoryAttributeAnswer {
  attributeId: string
  valueId?: string
  value?: string
}

export interface NewMarketplaceProductVariant {
  variantId: string
  sku: string
  size: string | null
  color: string | null
  style: string | null
  priceCents: number
  quantityAvailable: number
}

export interface NewMarketplaceProduct {
  name: string
  description: string
  /** Our own hosted image URLs — each adapter is responsible for fetching and re-uploading these through whatever image API the platform requires. */
  images: string[]
  categoryId: string
  attributeValues: MarketplaceCategoryAttributeAnswer[]
  variants: NewMarketplaceProductVariant[]
}

export interface CreatedMarketplaceProduct {
  externalProductId: string
  /** One entry per input variant (matched by sku), so the caller can create marketplace_product_mappings rows. */
  variants: { variantId: string; externalVariantId: string }[]
}

export interface MarketplaceFulfillmentUpdate {
  externalOrderId: string
  carrier: string | null
  trackingNumber: string | null
  status: 'shipped' | 'delivered'
}

export interface MarketplaceProductVariantDetail {
  externalVariantId: string
  externalSku: string | null
  /** The platform's own variant option values (e.g. ["S"], or ["S", "Red"] for a size+color combo), in whatever order the platform returns them. Matched against our variant's size/color/style by exact, case-sensitive value equality — connecting to an existing listing requires every value to line up exactly, the same way it works in the seller's existing Shopify-side sync app. */
  optionValues: string[]
}

export interface MarketplaceProductDetail {
  name: string
  variants: MarketplaceProductVariantDetail[]
}

/** One entry from the platform's product catalog — just enough to match against our own product titles. */
export interface MarketplaceProductSummary {
  externalProductId: string
  name: string
}

export interface MarketplaceAdapter {
  readonly marketplace: MarketplaceName

  /** Builds the URL to send the staff member to in order to authorize this app on the platform. */
  getAuthorizationUrl: (state: string) => string

  /** Exchanges the `code` param from the OAuth callback redirect for real tokens. `shopId` is required by platforms (Shopee) whose token exchange needs it up front — ignored by platforms (TikTok) that derive the shop from the token itself. */
  exchangeCodeForTokens: (code: string, shopId?: string) => Promise<OAuthTokens>

  /** Uses a still-valid refresh token to get a new access token before the old one expires. `shopId` is required by platforms (Shopee) whose refresh call needs it — ignored otherwise. */
  refreshTokens: (
    refreshToken: string,
    shopId?: string,
  ) => Promise<OAuthTokens>

  /** Pushes our current stock count for one variant to the platform. */
  pushInventory: (
    connection: MarketplaceConnection,
    externalProductId: string,
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

  /** Searches the platform's (usually very deep) category tree by keyword, returning matching leaf categories a product can actually be filed under. */
  listCategories: (
    connection: MarketplaceConnection,
    query: string,
  ) => Promise<MarketplaceCategory[]>

  /** Fetches the attributes a product must (or can) specify once filed under this category. */
  getCategoryAttributes: (
    connection: MarketplaceConnection,
    categoryId: string,
  ) => Promise<MarketplaceCategoryAttribute[]>

  /** Creates a brand-new listing on the platform — uploading images, creating every variant — from our product data. Used the first time a product is pushed to this channel, as opposed to pushInventory which only updates stock on an already-linked listing. */
  createProduct: (
    connection: MarketplaceConnection,
    input: NewMarketplaceProduct,
  ) => Promise<CreatedMarketplaceProduct>

  /** Tells the platform an order has shipped or been delivered, so its own status/tracking display stays accurate instead of showing "unfulfilled" forever. */
  updateFulfillment: (
    connection: MarketplaceConnection,
    update: MarketplaceFulfillmentUpdate,
  ) => Promise<void>

  /** Fetches an existing listing's title and variants by the platform's own product id — used to validate an exact title/variant match before connecting to it, rather than trusting a manually-typed SKU id. Throws if no such product exists. */
  getProductByExternalId: (
    connection: MarketplaceConnection,
    externalProductId: string,
  ) => Promise<MarketplaceProductDetail>

  /** Lists every product currently listed on the platform's own catalog (title + id only) — used to auto-match against our local product titles instead of requiring staff to paste in each external product id by hand. */
  listProducts: (
    connection: MarketplaceConnection,
  ) => Promise<MarketplaceProductSummary[]>
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

/**
 * Lazada adapter — not implemented yet, waiting on API account approval.
 * See shopee/adapter.ts for the same note; the pattern is identical here.
 * Lazada's Open Platform uses app_key/app_secret HMAC-SHA256 signing too,
 * with its own OAuth and order/product endpoints — same shape of work as
 * TikTok Shop once credentials are available.
 */
import type { MarketplaceAdapter } from '#/server/integrations/marketplaces/types'
import { AdapterNotImplementedError } from '#/server/integrations/marketplaces/types'

function notImplemented(): never {
  throw new AdapterNotImplementedError('lazada')
}

export const lazadaAdapter: MarketplaceAdapter = {
  marketplace: 'lazada',
  getAuthorizationUrl: notImplemented,
  exchangeCodeForTokens: notImplemented,
  refreshTokens: notImplemented,
  pushInventory: notImplemented,
  pullOrders: notImplemented,
  mapOrderToInternalFormat: notImplemented,
  listCategories: notImplemented,
  getCategoryAttributes: notImplemented,
  createProduct: notImplemented,
  updateFulfillment: notImplemented,
  getProductByExternalId: notImplemented,
}

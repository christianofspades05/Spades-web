/**
 * Shopee adapter — not implemented yet, waiting on API account approval.
 * Every method throws so the registry (../registry.ts) can still list this
 * marketplace (for the admin Channels page to show "Not connected — coming
 * soon") without anything actually being callable.
 *
 * When ready: follow tiktok-shop/ as the template — a client.ts for the raw
 * signed HTTP calls (Shopee uses partner_id/partner_key HMAC-SHA256 signing,
 * conceptually similar to TikTok's but with different parameters) and this
 * file implementing MarketplaceAdapter using it. Nothing outside this
 * folder and registry.ts needs to change.
 */
import type { MarketplaceAdapter } from '#/server/integrations/marketplaces/types'
import { AdapterNotImplementedError } from '#/server/integrations/marketplaces/types'

function notImplemented(): never {
  throw new AdapterNotImplementedError('shopee')
}

export const shopeeAdapter: MarketplaceAdapter = {
  marketplace: 'shopee',
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

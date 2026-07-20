/**
 * The one place that knows which marketplace names map to which adapter
 * implementation. Everything else (sync engine, admin UI, cron jobs) asks
 * this registry for an adapter rather than importing a platform's adapter
 * file directly — that's what lets Shopee/Lazada plug in later by adding one
 * line here instead of touching call sites all over the codebase.
 */
import type { MarketplaceName } from '#/types/entities'
import type { MarketplaceAdapter } from './types'
import { AdapterNotImplementedError } from './types'
import { tiktokShopAdapter } from './tiktok-shop/adapter'
import { shopeeAdapter } from './shopee/adapter'
import { lazadaAdapter } from './lazada/adapter'

const ADAPTERS: Record<MarketplaceName, MarketplaceAdapter | null> = {
  tiktok_shop: tiktokShopAdapter,
  shopee: shopeeAdapter,
  lazada: lazadaAdapter,
  other: null,
}

export function getAdapter(marketplace: MarketplaceName): MarketplaceAdapter {
  const adapter = ADAPTERS[marketplace]
  if (!adapter) throw new AdapterNotImplementedError(marketplace)
  return adapter
}

// Re-exported for existing server-side importers — moved to its own
// adapter-free file (implemented.ts) so client-bundled code (the admin
// Channels route) can use the list without pulling in every adapter's
// Node-only client code. New code should import from implemented.ts
// directly rather than through here.
export { IMPLEMENTED_MARKETPLACES } from './implemented'

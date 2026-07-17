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

/** Marketplaces with a real (non-stub) adapter — drives what the admin Channels page offers to connect. */
export const IMPLEMENTED_MARKETPLACES: MarketplaceName[] = ['tiktok_shop']

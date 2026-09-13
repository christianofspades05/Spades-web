/**
 * Public read of active per-country product-price markups (see
 * server/admin/market-pricing.ts for the admin CRUD side) — mirrors
 * server/currency/rates.ts's getExchangeRates exactly: a small reference
 * table, fetched whole, no per-country round trip. Checkout needs this so
 * the displayed total matches what place-order.ts is about to actually
 * charge — never applied to shipping, see lib/checkout/market-pricing.ts.
 */
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '#/lib/supabase/server'
import { createSharedCache } from '#/lib/utils/shared-cache'

export type MarketMarkups = Record<string, number>

/** Both caches below are tagged with this and invalidated together by
 *  server/admin/market-pricing.ts's createMarket/updateMarket, since
 *  editing any one market can change either aggregate (a market's
 *  countries feed both the markup and shipping lookups) and each is
 *  cached as a single whole-table blob, not per-market — there's no
 *  finer-grained key to invalidate selectively. */
const MARKET_CONFIG_CACHE_TAG = 'market-config'

// createSharedCache wraps Vercel Runtime Cache, a single flat key/value
// namespace for the whole deployment — unlike the old createPromiseCache
// (a fresh, isolated Map per cache instance), two different
// createSharedCache instances both calling .get('default', ...) would read
// and overwrite the exact same physical entry. Markups and shipping are
// deliberately keyed 'market-markups'/'market-shipping' below, not both
// 'default', to avoid exactly that collision.

/** Invalidates both getActiveMarketMarkups' and getActiveMarketShipping's
 *  cached aggregates — called by every admin write path that can change a
 *  market's countries, markup, or shipping configuration (createMarket,
 *  updateMarket). Safe to call even if nothing is currently cached —
 *  Runtime Cache's expireTag is a no-op for a tag with nothing tagged. */
export function invalidateMarketConfigCache(): Promise<void> {
  return Promise.all([
    marketMarkupsCache.invalidate([MARKET_CONFIG_CACHE_TAG]),
    marketShippingCache.invalidate([MARKET_CONFIG_CACHE_TAG]),
  ]).then(() => undefined)
}

// `markets` has no brand column — pricing/shipping overrides are shared
// across Spades/Ysrael/Aspire365 by design, and the query already returns
// every active market's data in one shot (not scoped to one visitor's
// country), so a single fixed cache key is correct here — there's no
// brand/country dimension to key on.
//
// Backed by Vercel Runtime Cache (shared across every warm instance in the
// region), not a process-local cache — same createSharedCache pattern (and
// same reasoning: one fixed key, low write frequency, called on every
// single storefront page load via CurrencyProvider) already proven this
// session on collectionListingScopeCache/collectionScopeCache. A 300s TTL
// is safe here specifically because BOTH admin write paths that can change
// this data (createMarket, updateMarket — verified to be the only two)
// call invalidateMarketConfigCache immediately after a successful write,
// so staleness is bounded by invalidation, not by waiting out the TTL.
const MARKET_MARKUPS_CACHE_TTL_SECONDS = 300
const marketMarkupsCache = createSharedCache<MarketMarkups>(
  MARKET_MARKUPS_CACHE_TTL_SECONDS,
)

function isMarketMarkups(value: unknown): value is MarketMarkups {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((v) => typeof v === 'number')
  )
}

// Wrapped in createServerOnlyFn, not a plain function — same reasoning as
// resolveMaintenanceMode in maintenance.ts: a plain exported function
// touching a server-only import (getSupabaseServerClient) needs this
// wrapper, or the build's import-protection plugin correctly refuses to
// bundle it into any client-rendered route that imports this file (e.g.
// checkout/index.tsx). This also happens to be what lets it be exercised
// directly in tests without a real TanStack Start request context, the
// same benefit server/products/queries.ts's getCollectionListingScope has.
export const fetchActiveMarketMarkups = createServerOnlyFn(
  (): Promise<MarketMarkups> =>
    marketMarkupsCache.get(
      'market-markups',
      async () => {
        const supabase = getSupabaseServerClient()
        const { data, error } = await supabase
          .from('markets')
          .select('markup_percent, market_countries(country_code)')
          .eq('is_active', true)
        if (error) throw error
        const markups: MarketMarkups = {}
        for (const market of data) {
          for (const { country_code } of market.market_countries) {
            markups[country_code] = market.markup_percent
          }
        }
        return markups
      },
      { tags: [MARKET_CONFIG_CACHE_TAG], isValid: isMarketMarkups },
    ),
)

export const getActiveMarketMarkups = createServerFn({
  method: 'GET',
}).handler((): Promise<MarketMarkups> => fetchActiveMarketMarkups())

/** A market's shipping override — `shippingPriceCents` null means the
 *  market hasn't set a custom fee, so shippingCostCents falls back to the
 *  flat international rate. At most one free-shipping trigger is normally
 *  set at a time, but shippingCostCents treats both as an OR just in case. */
export interface MarketShippingConfig {
  shippingPriceCents: number | null
  /** Currency shippingPriceCents is denominated in (e.g. 'SGD') — always
   *  converted to PHP live at checkout via the same exchange_rates table
   *  the storefront currency selector uses, never assumed to be PHP. */
  shippingCurrency: string
  freeShippingMinSubtotalCents: number | null
  freeShippingMinItems: number | null
}
export type MarketShippingByCountry = Record<string, MarketShippingConfig>

// Same no-brand-dimension and shared-cache reasoning as marketMarkupsCache
// above — a single fixed key, own cache instance (kept separate from
// markups' since they're independent queries with independent staleness
// needs, even though the TTL and tag happen to match).
const MARKET_SHIPPING_CACHE_TTL_SECONDS = 300
const marketShippingCache = createSharedCache<MarketShippingByCountry>(
  MARKET_SHIPPING_CACHE_TTL_SECONDS,
)

function isMarketShippingByCountry(
  value: unknown,
): value is MarketShippingByCountry {
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value).every(
    (v) =>
      typeof v === 'object' &&
      v !== null &&
      'shippingCurrency' in v &&
      'freeShippingMinSubtotalCents' in v &&
      'freeShippingMinItems' in v,
  )
}

// Same reasoning as fetchActiveMarketMarkups above.
export const fetchActiveMarketShipping = createServerOnlyFn(
  (): Promise<MarketShippingByCountry> =>
    marketShippingCache.get(
      'market-shipping',
      async () => {
        const supabase = getSupabaseServerClient()
        const { data, error } = await supabase
          .from('markets')
          .select(
            'shipping_price_cents, shipping_currency, free_shipping_min_subtotal_cents, free_shipping_min_items, market_countries(country_code)',
          )
          .eq('is_active', true)
        if (error) throw error
        const shipping: MarketShippingByCountry = {}
        for (const market of data) {
          for (const { country_code } of market.market_countries) {
            shipping[country_code] = {
              shippingPriceCents: market.shipping_price_cents,
              shippingCurrency: market.shipping_currency,
              freeShippingMinSubtotalCents:
                market.free_shipping_min_subtotal_cents,
              freeShippingMinItems: market.free_shipping_min_items,
            }
          }
        }
        return shipping
      },
      { tags: [MARKET_CONFIG_CACHE_TAG], isValid: isMarketShippingByCountry },
    ),
)

export const getActiveMarketShipping = createServerFn({
  method: 'GET',
}).handler(
  (): Promise<MarketShippingByCountry> => fetchActiveMarketShipping(),
)

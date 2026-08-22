/**
 * Public read of active per-country product-price markups (see
 * server/admin/market-pricing.ts for the admin CRUD side) — mirrors
 * server/currency/rates.ts's getExchangeRates exactly: a small reference
 * table, fetched whole, no per-country round trip. Checkout needs this so
 * the displayed total matches what place-order.ts is about to actually
 * charge — never applied to shipping, see lib/checkout/market-pricing.ts.
 */
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '#/lib/supabase/server'
import { createPromiseCache } from '#/lib/utils/cache'

export type MarketMarkups = Record<string, number>

// `markets` has no brand column — pricing/shipping overrides are shared
// across Spades/Ysrael/Aspire365 by design, and the query already returns
// every active market's data in one shot (not scoped to one visitor's
// country), so a single fixed cache key is correct here — there's no
// brand/country dimension to key on. Same 30s TTL and promise-caching
// rationale as maintenance.ts/banner.ts: called on every single storefront
// page load, so caching the in-flight promise (not just the resolved
// value) keeps a burst of concurrent visitors from all missing at once.
const MARKET_MARKUPS_CACHE_TTL_MS = 30_000
const marketMarkupsCache = createPromiseCache<MarketMarkups>(
  MARKET_MARKUPS_CACHE_TTL_MS,
)

export const getActiveMarketMarkups = createServerFn({
  method: 'GET',
}).handler(async (): Promise<MarketMarkups> => {
  return marketMarkupsCache.get('default', async () => {
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
  })
})

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

// Same no-brand-dimension reasoning as marketMarkupsCache above — a single
// fixed key, own cache instance (kept separate from markups' since they're
// independent queries with independent staleness needs, even though the
// TTL happens to match today).
const MARKET_SHIPPING_CACHE_TTL_MS = 30_000
const marketShippingCache = createPromiseCache<MarketShippingByCountry>(
  MARKET_SHIPPING_CACHE_TTL_MS,
)

export const getActiveMarketShipping = createServerFn({
  method: 'GET',
}).handler(async (): Promise<MarketShippingByCountry> => {
  return marketShippingCache.get('default', async () => {
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
  })
})

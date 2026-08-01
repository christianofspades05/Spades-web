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

export type MarketMarkups = Record<string, number>

export const getActiveMarketMarkups = createServerFn({
  method: 'GET',
}).handler(async (): Promise<MarketMarkups> => {
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

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
    .from('market_pricing')
    .select('country_code, markup_percent')
    .eq('is_active', true)
  if (error) throw error
  return Object.fromEntries(data.map((m) => [m.country_code, m.markup_percent]))
})

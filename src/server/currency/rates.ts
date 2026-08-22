/**
 * Reads the exchange_rates table (refreshed daily by
 * api/cron/sync-exchange-rates) — never calls the external rate API
 * directly, so a page render never depends on that API's uptime/latency.
 */
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '#/lib/supabase/server'
import type { ExchangeRates } from '#/lib/utils/money'
import { createPromiseCache } from '#/lib/utils/cache'

// The underlying table only ever changes once a day (the sync cron above)
// and has no admin edit UI to react to sooner, so a much longer TTL than
// maintenance/banner's 30s is safe here — 15 minutes still means any day's
// sync (or a manual DB correction, if one's ever needed) is visible almost
// immediately, while cutting real calls by over 99% instead of ~30x. No
// brand/currency dimension to key on: the query already returns every
// currency in one shot, so a single fixed key is correct.
const EXCHANGE_RATES_CACHE_TTL_MS = 15 * 60_000
const exchangeRatesCache = createPromiseCache<ExchangeRates>(
  EXCHANGE_RATES_CACHE_TTL_MS,
)

export const getExchangeRates = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ExchangeRates> => {
    return exchangeRatesCache.get('default', async () => {
      const supabase = getSupabaseServerClient()
      const { data, error } = await supabase
        .from('exchange_rates')
        .select('currency, rate_to_php')
      if (error) throw error
      return Object.fromEntries(data.map((r) => [r.currency, r.rate_to_php]))
    })
  },
)

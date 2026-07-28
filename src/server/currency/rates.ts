/**
 * Reads the exchange_rates table (refreshed daily by
 * api/cron/sync-exchange-rates) — never calls the external rate API
 * directly, so a page render never depends on that API's uptime/latency.
 */
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '#/lib/supabase/server'
import type { ExchangeRates } from '#/lib/utils/money'

export const getExchangeRates = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ExchangeRates> => {
    const supabase = getSupabaseServerClient()
    const { data, error } = await supabase
      .from('exchange_rates')
      .select('currency, rate_to_php')
    if (error) throw error
    return Object.fromEntries(data.map((r) => [r.currency, r.rate_to_php]))
  },
)

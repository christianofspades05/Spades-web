/**
 * Combines the three requests CurrencyProvider fires on every fresh
 * storefront session (getExchangeRates, getActiveMarketMarkups,
 * getActiveMarketShipping) into one round trip — all three already fire on
 * the exact same trigger (provider mount) for the exact same purpose
 * (pricing display), just as three separate serverFn calls instead of one.
 * Confirmed live this session: ~21,197 combined calls/day across the three,
 * ~13.3% of total /__server volume.
 *
 * Reuses each function's own existing fetch-and-cache logic exactly as-is
 * (fetchExchangeRates, fetchActiveMarketMarkups, fetchActiveMarketShipping)
 * — no query duplicated, no cache bypassed. getExchangeRates/
 * getActiveMarketMarkups/getActiveMarketShipping themselves are untouched
 * and still called directly elsewhere (checkout's own authoritative
 * re-fetch for the customer's *chosen* country, as opposed to this
 * bootstrap's geo-guessed one — see CurrencyContext.tsx's own comment on
 * that distinction).
 *
 * Each of the three is caught independently, not a single Promise.all that
 * fails whole — CurrencyProvider's old three-separate-useEffect
 * implementation had no .catch() on any of them, so today a rejected
 * getExchangeRates() simply leaves `rates` at its {} default while
 * markups/shipping populate normally from their own independent promises,
 * and vice versa. Mirrors that exact same independent-fallback shape
 * (also the same pattern getRootLoaderData already uses for its own
 * multi-field combined response), so one field failing here can never take
 * the other two down with it.
 */
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { fetchExchangeRates } from '#/server/currency/rates'
import {
  fetchActiveMarketMarkups,
  fetchActiveMarketShipping,
} from '#/server/storefront/market-pricing'
import type {
  MarketMarkups,
  MarketShippingByCountry,
} from '#/server/storefront/market-pricing'
import type { ExchangeRates } from '#/lib/utils/money'

export interface CurrencyMarketBootstrap {
  rates: ExchangeRates
  markups: MarketMarkups
  shipping: MarketShippingByCountry
}

// Wrapped in createServerOnlyFn, not a plain function — same reasoning as
// rates.ts's fetchExchangeRates and market-pricing.ts's
// fetchActiveMarketMarkups/fetchActiveMarketShipping: lets this be exercised
// directly in tests without a real request context (a createServerFn export
// throws "No Start context found in AsyncLocalStorage" if called directly).
export const fetchCurrencyMarketBootstrap = createServerOnlyFn(
  async (): Promise<CurrencyMarketBootstrap> => {
    const [rates, markups, shipping] = await Promise.all([
      fetchExchangeRates().catch((err: unknown) => {
        console.error('getCurrencyMarketBootstrap: fetchExchangeRates failed:', err)
        return {} as ExchangeRates
      }),
      fetchActiveMarketMarkups().catch((err: unknown) => {
        console.error(
          'getCurrencyMarketBootstrap: fetchActiveMarketMarkups failed:',
          err,
        )
        return {} as MarketMarkups
      }),
      fetchActiveMarketShipping().catch((err: unknown) => {
        console.error(
          'getCurrencyMarketBootstrap: fetchActiveMarketShipping failed:',
          err,
        )
        return {} as MarketShippingByCountry
      }),
    ])

    return { rates, markups, shipping }
  },
)

export const getCurrencyMarketBootstrap = createServerFn({
  method: 'GET',
}).handler((): Promise<CurrencyMarketBootstrap> => fetchCurrencyMarketBootstrap())

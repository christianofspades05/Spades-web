import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getExchangeRates } from '#/server/currency/rates'
import {
  getActiveMarketMarkups,
  getActiveMarketShipping,
} from '#/server/storefront/market-pricing'
import type {
  MarketMarkups,
  MarketShippingByCountry,
} from '#/server/storefront/market-pricing'
import { applyMarketMarkup } from '#/lib/checkout/market-pricing'
import { freeShippingProgress } from '#/lib/checkout/shipping'
import type { FreeShippingProgress } from '#/lib/checkout/shipping'
import {
  convertCents,
  effectiveCurrency,
  formatCents,
  SUPPORTED_CURRENCIES,
} from '#/lib/utils/money'
import type { Currency, ExchangeRates } from '#/lib/utils/money'

export { SUPPORTED_CURRENCIES }
export type { Currency }

interface CurrencyContextValue {
  currency: Currency
  setCurrency: (next: Currency) => void
  rates: ExchangeRates
  /** Converts + formats in one call — the one-line swap for
   *  `formatCentsAsPHP(x)` call sites throughout the storefront. */
  formatPrice: (cents: number) => string
  /** Same as formatPrice, but also applies the geo-detected visitor
   *  country's product markup first (see lib/checkout/market-pricing.ts) —
   *  for browsing surfaces only (product cards, PDP, cart, search). NOT
   *  for checkout, which uses the customer's explicitly *chosen* shipping
   *  country instead of a geo guess, and not for historical order display,
   *  which must never change after the fact. */
  formatPriceWithMarkup: (cents: number) => string
  /** How far a cart is from free shipping for the geo-guessed visitor
   *  country — same "browsing surfaces only" caveat as formatPriceWithMarkup
   *  above (the add-to-cart popup and cart page, before checkout has an
   *  actual chosen country to go on). `rawSubtotalCents` is the un-marked-up
   *  PHP subtotal, same input formatPriceWithMarkup expects. */
  freeShippingProgressForBrowsing: (
    rawSubtotalCents: number,
    itemCount: number,
  ) => FreeShippingProgress | null
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null)

const STORAGE_KEY = 'currency'

function isSupportedCurrency(value: string | null): value is Currency {
  return (
    value !== null &&
    (SUPPORTED_CURRENCIES as readonly string[]).includes(value)
  )
}

/**
 * Storefront-only, display-currency selector. Defaults to 'PHP' on both
 * server and first client render (so hydration always matches, same
 * reasoning as ThemeProvider) — the effect below then checks localStorage
 * first, and only falls back to the geolocation-derived default (passed
 * down from __root.tsx's beforeLoad, reading Vercel's ip-country header)
 * when there's no stored preference yet. Every payment except card still
 * always charges/settles in PHP regardless of this value — see
 * lib/xendit/client.ts's doc comment for why only card can honor it.
 */
export function CurrencyProvider({
  children,
  geoDefaultCurrency,
  geoCountry,
}: {
  children: React.ReactNode
  geoDefaultCurrency: Currency | null
  geoCountry: string | null
}) {
  const [currency, setCurrencyState] = useState<Currency>('PHP')
  const [rates, setRates] = useState<ExchangeRates>({})
  const [marketMarkups, setMarketMarkups] = useState<MarketMarkups>({})
  const [marketShipping, setMarketShipping] = useState<MarketShippingByCountry>(
    {},
  )

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isSupportedCurrency(stored)) {
      setCurrencyState(stored)
    } else if (geoDefaultCurrency) {
      setCurrencyState(geoDefaultCurrency)
    }
  }, [geoDefaultCurrency])

  useEffect(() => {
    getExchangeRates().then(setRates)
  }, [])

  useEffect(() => {
    getActiveMarketMarkups().then(setMarketMarkups)
  }, [])

  useEffect(() => {
    getActiveMarketShipping().then(setMarketShipping)
  }, [])

  function setCurrency(next: Currency) {
    localStorage.setItem(STORAGE_KEY, next)
    setCurrencyState(next)
  }

  const formatPrice = useMemo(
    () => (cents: number) => {
      const target = effectiveCurrency(currency, rates)
      return formatCents(convertCents(cents, target, rates), target)
    },
    [currency, rates],
  )

  const geoMarkupPercent = geoCountry ? marketMarkups[geoCountry] : undefined
  const formatPriceWithMarkup = useMemo(
    () => (cents: number) =>
      formatPrice(applyMarketMarkup(cents, geoMarkupPercent)),
    [formatPrice, geoMarkupPercent],
  )

  const freeShippingProgressForBrowsing = useMemo(
    () => (rawSubtotalCents: number, itemCount: number) => {
      const country = geoCountry ?? 'PH'
      const markedUpSubtotal = applyMarketMarkup(
        rawSubtotalCents,
        geoMarkupPercent,
      )
      return freeShippingProgress(
        country,
        markedUpSubtotal,
        itemCount,
        marketShipping[country],
      )
    },
    [geoCountry, geoMarkupPercent, marketShipping],
  )

  return (
    <CurrencyContext.Provider
      value={{
        currency,
        setCurrency,
        rates,
        formatPrice,
        formatPriceWithMarkup,
        freeShippingProgressForBrowsing,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext)
  if (!ctx) {
    throw new Error('useCurrency must be used within a CurrencyProvider')
  }
  return ctx
}

/** One-line swap for `formatCentsAsPHP(x)` call sites. */
export function useFormattedPrice(cents: number): string {
  return useCurrency().formatPrice(cents)
}

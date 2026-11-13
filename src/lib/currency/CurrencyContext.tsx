import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getCurrencyMarketBootstrap } from '#/server/storefront/currency-bootstrap'
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
  /** False until the exchange-rates bootstrap fetch below has resolved at
   *  least once. Before that, `rates` is `{}` and `effectiveCurrency`/
   *  `convertCents` silently fall back to PHP — fine for display (PHP is a
   *  correct price), but callers that report a (value, currency) pair to an
   *  external system (e.g. the Meta Pixel InitiateCheckout event) must wait
   *  for this to be true first, or they'll report PHP-denominated values
   *  tagged with whatever currency the visitor actually has selected. */
  ratesLoaded: boolean
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
  /** Set once per session (see dismissCurrencySuggestion/
   *  acceptCurrencySuggestion below) for a first-time visitor whose
   *  geo-detected country maps to a non-PHP currency — never auto-applied.
   *  Confirmed live: Vercel's IP geolocation misattributes a meaningful
   *  share of real Philippine mobile traffic (data-saver proxy browsers
   *  like Opera Mini/UC Browser, and carrier compression proxies, routing
   *  through a regional hub — commonly Singapore) to the wrong country, so
   *  silently switching the home market's own customers to a foreign
   *  display currency on every other visit was a real, recurring bug, not
   *  a one-off. PHP stays the default for everyone; this only powers an
   *  explicit, dismissible suggestion (see CurrencySuggestionBanner). */
  /** The geo-guessed visitor country (PH when unknown) — the same
   *  browsing-only signal freeShippingProgressForBrowsing uses. */
  browsingCountry: string
  suggestedCurrency: Currency | null
  showCurrencySuggestion: boolean
  acceptCurrencySuggestion: () => void
  dismissCurrencySuggestion: () => void
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null)

const STORAGE_KEY = 'currency'
/** Session-only (not localStorage) — a dismissed suggestion should stay
 *  dismissed for the rest of this visit, but come back and offer again on
 *  a later visit rather than being suppressed forever off one dismiss. */
const DISMISSED_SESSION_KEY = 'currency_suggestion_dismissed'

function isSupportedCurrency(value: string | null): value is Currency {
  return (
    value !== null &&
    (SUPPORTED_CURRENCIES as readonly string[]).includes(value)
  )
}

/**
 * Storefront-only, display-currency selector. Defaults to 'PHP' on both
 * server and first client render (so hydration always matches, same
 * reasoning as ThemeProvider) and PHP stays the default for the rest of
 * the session too — the effect below checks localStorage first, and a
 * returning visitor's own stored choice always wins, but a first-time
 * visitor's geo-detected currency (passed down from __root.tsx's
 * beforeLoad, reading Vercel's ip-country header) is never auto-applied
 * anymore, only offered via suggestedCurrency/showCurrencySuggestion (see
 * those fields' doc comments) — IP geolocation isn't reliable enough to
 * silently act on for a store whose own customers are disproportionately
 * affected by it. Every payment except card still always charges/settles
 * in PHP regardless of this value — see lib/xendit/client.ts's doc comment
 * for why only card can honor it.
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
  const [ratesLoaded, setRatesLoaded] = useState(false)
  const [marketMarkups, setMarketMarkups] = useState<MarketMarkups>({})
  const [marketShipping, setMarketShipping] = useState<MarketShippingByCountry>(
    {},
  )
  const [showCurrencySuggestion, setShowCurrencySuggestion] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isSupportedCurrency(stored)) {
      setCurrencyState(stored)
      return
    }
    if (
      geoDefaultCurrency &&
      geoDefaultCurrency !== 'PHP' &&
      sessionStorage.getItem(DISMISSED_SESSION_KEY) !== '1'
    ) {
      setShowCurrencySuggestion(true)
    }
  }, [geoDefaultCurrency])

  // One combined request instead of three separate ones — see
  // server/storefront/currency-bootstrap.ts's own doc comment. Each of the
  // three pieces of state is still populated (or left at its {} default on
  // that one piece's own failure) exactly as before; only the number of
  // round trips changed.
  useEffect(() => {
    getCurrencyMarketBootstrap()
      .then((bootstrap) => {
        setRates(bootstrap.rates)
        setMarketMarkups(bootstrap.markups)
        setMarketShipping(bootstrap.shipping)
      })
      .catch(() => {})
      .finally(() => setRatesLoaded(true))
  }, [])

  function setCurrency(next: Currency) {
    localStorage.setItem(STORAGE_KEY, next)
    setCurrencyState(next)
  }

  function acceptCurrencySuggestion() {
    if (geoDefaultCurrency) setCurrency(geoDefaultCurrency)
    setShowCurrencySuggestion(false)
  }

  function dismissCurrencySuggestion() {
    sessionStorage.setItem(DISMISSED_SESSION_KEY, '1')
    setShowCurrencySuggestion(false)
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
        ratesLoaded,
        formatPrice,
        formatPriceWithMarkup,
        freeShippingProgressForBrowsing,
        browsingCountry: geoCountry ?? 'PH',
        suggestedCurrency: geoDefaultCurrency,
        showCurrencySuggestion,
        acceptCurrencySuggestion,
        dismissCurrencySuggestion,
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

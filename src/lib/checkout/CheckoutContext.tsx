import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ncrProvinceFallback } from '#/lib/utils/ph-region'
import {
  forgetReturningCustomer,
  isCheckoutInfoBlank,
  loadReturningCustomer,
} from '#/lib/checkout/returning-customer'
import { getCheckoutPrefill } from '#/server/checkout/prefill'

export interface CheckoutInfo {
  email: string
  recipientName: string
  phone: string
  /** ISO 3166-1 alpha-2. 'PH' drives the region/province/barangay PH
   *  address flow; anything else uses the general international fields
   *  (province/city as free text, postalCode required, no barangay). */
  country: string
  region: string
  province: string
  city: string
  barangay: string
  postalCode: string
  addressLine1: string
  addressLine2: string
  landmark: string
  /** 'lalamove' only ever applies to Spades/Metro-Manila, any day except
   *  Sunday — see lib/checkout/lalamove-eligibility.ts. Its delivery fee
   *  (lalamoveEstimatedFeeCents, plus a buffer) is charged online together
   *  with the items, same as any other shipping method. */
  shippingMethod: 'standard' | 'lalamove'
  lalamoveDropoffLat: number | null
  lalamoveDropoffLng: number | null
  lalamoveDropoffAddress: string
  lalamoveEstimatedFeeCents: number | null
  /** Customer-entered checkout note (delivery instructions, etc.) — shown
   *  read-only to staff on the order detail page. */
  orderNotes: string
}

export const EMPTY_CHECKOUT_INFO: CheckoutInfo = {
  email: '',
  recipientName: '',
  phone: '',
  country: 'PH',
  region: '',
  province: '',
  city: '',
  barangay: '',
  postalCode: '',
  addressLine1: '',
  addressLine2: '',
  landmark: '',
  shippingMethod: 'standard',
  lalamoveDropoffLat: null,
  lalamoveDropoffLng: null,
  lalamoveDropoffAddress: '',
  lalamoveEstimatedFeeCents: null,
  orderNotes: '',
}

const STORAGE_KEY = 'spades_checkout_info'

/** Falls back to the visitor's geo-detected country (see server/currency/geo.ts
 *  — the same signal CurrencyProvider/LanguageProvider already use) rather
 *  than always defaulting to PH, so a shopper visiting from e.g. Japan
 *  doesn't have to manually change the country field away from the wrong
 *  default. Only kicks in for a fresh checkout with nothing saved yet — a
 *  returning shopper's own choice (including PH) always wins. Restricted to
 *  `knownMarketCountries` (the markets the site actually has pricing/
 *  shipping configured for — see getActiveMarketMarkups, fetched by
 *  routes/checkout.tsx) rather than any geo-detected country, since an
 *  unconfigured country wouldn't show up in the checkout's own country
 *  picker (see CountrySelect's countryCodes prop) anyway. Used to piggyback
 *  on COUNTRY_DEFAULT_LANGUAGE's unrelated country list instead of the
 *  actual market config — confirmed live as the cause of an Australian
 *  visitor (a real configured market, just not one COUNTRY_DEFAULT_LANGUAGE
 *  happened to also list) still defaulting to PH at checkout. */
function readStoredInfo(
  geoCountry: string | null,
  knownMarketCountries: readonly string[],
): { info: CheckoutInfo; fromSession: boolean } {
  if (typeof window === 'undefined') {
    return { info: EMPTY_CHECKOUT_INFO, fromSession: false }
  }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (raw) {
      return {
        info: { ...EMPTY_CHECKOUT_INFO, ...JSON.parse(raw) },
        fromSession: true,
      }
    }
  } catch {
    // fall through to the geo default below
  }
  return {
    info:
      geoCountry && knownMarketCountries.includes(geoCountry)
        ? { ...EMPTY_CHECKOUT_INFO, country: geoCountry }
        : EMPTY_CHECKOUT_INFO,
    fromSession: false,
  }
}

/** Only the non-empty values, so a prefill never blanks out a field. */
function nonEmpty(values: Partial<CheckoutInfo>): Partial<CheckoutInfo> {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => typeof v === 'string' && v),
  )
}

/** The destination a shopper already entered at checkout this session, if
 *  any — read straight from sessionStorage so pages outside the checkout
 *  route (where CheckoutProvider isn't mounted, e.g. the cart) can show an
 *  exact shipping fee instead of an estimate. Null when nothing's saved. */
export function readSavedCheckoutDestination(): {
  country: string
  region: string
  province: string
} | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as Partial<CheckoutInfo>
    if (!saved.country) return null
    return {
      country: saved.country,
      region: saved.region ?? '',
      province: ncrProvinceFallback(saved.region ?? '', saved.province ?? ''),
    }
  } catch {
    return null
  }
}

/** NCR has no real province in the PSGC data (see PHAddressFields) — fill in a sensible label before this goes anywhere that requires one (validation, the order's address snapshot). */
export function withSubmittableProvince(info: CheckoutInfo): CheckoutInfo {
  return {
    ...info,
    province: ncrProvinceFallback(info.region, info.province),
  }
}

/** True once the contact + delivery address fields are all filled in. */
export function isCheckoutInfoComplete(info: CheckoutInfo): boolean {
  const hasCommon = Boolean(
    info.email &&
    info.recipientName &&
    info.phone &&
    info.city &&
    info.addressLine1 &&
    // Postal code is optional for PH, required everywhere else.
    (info.country === 'PH' || info.postalCode),
  )
  if (!hasCommon) return false
  if (info.shippingMethod === 'lalamove') {
    if (info.lalamoveDropoffLat == null || info.lalamoveDropoffLng == null) {
      return false
    }
  }
  if (info.country === 'PH') {
    return Boolean(info.region && info.barangay)
  }
  return Boolean(info.province)
}

interface CheckoutContextValue {
  info: CheckoutInfo
  setInfo: (info: CheckoutInfo) => void
  clear: () => void
  /** Where the form's starting values came from, when they weren't typed
   *  this session: 'device' = remembered from this browser's last order,
   *  'account' = the signed-in customer's profile/address book. */
  prefillSource: 'device' | 'account' | null
  /** "Not you?" — forget this device's remembered details and empty the form. */
  forgetPrefill: () => void
}

const CheckoutContext = createContext<CheckoutContextValue | null>(null)

export function CheckoutProvider({
  children,
  geoCountry,
  knownMarketCountries,
}: {
  children: ReactNode
  geoCountry: string | null
  /** 'PH' plus every country an active market covers — see
   *  routes/checkout.tsx's loader (getActiveMarketMarkups). */
  knownMarketCountries: readonly string[]
}) {
  const [info, setInfoState] = useState<CheckoutInfo>(EMPTY_CHECKOUT_INFO)
  const [prefillSource, setPrefillSource] = useState<
    'device' | 'account' | null
  >(null)

  // Deliberately keyed on geoCountry alone, not knownMarketCountries too
  // (a fresh array every render, since loader data isn't memoized) — this
  // should run once per geoCountry change, not re-run and wipe a shopper's
  // in-progress edits just because the markets array's identity changed.
  //
  // With nothing saved this session, a returning shopper starts prefilled:
  // first from this device's last order (instant, no request), otherwise
  // from their account if they're signed in. Done here, right after the
  // restore, rather than in the checkout page — React runs a child's
  // effects before its parent's, so a page-level prefill would race this
  // restore and could overwrite a shopper's in-progress form.
  useEffect(() => {
    const stored = readStoredInfo(geoCountry, knownMarketCountries)
    if (stored.fromSession) {
      setInfoState(stored.info)
      return
    }
    const remembered = loadReturningCustomer()
    if (remembered) {
      setInfoState({ ...stored.info, ...nonEmpty(remembered) })
      setPrefillSource('device')
      return
    }
    setInfoState(stored.info)
    let cancelled = false
    getCheckoutPrefill()
      .then((prefill) => {
        if (cancelled || !prefill) return
        // Only if the shopper hasn't started typing while this loaded.
        setInfoState((current) =>
          isCheckoutInfoBlank(current)
            ? { ...current, ...nonEmpty(prefill) }
            : current,
        )
        setPrefillSource('account')
      })
      .catch(() => {
        // Prefill is a convenience — an empty form is always fine.
      })
    return () => {
      cancelled = true
    }
  }, [geoCountry])

  function forgetPrefill() {
    forgetReturningCustomer()
    setPrefillSource(null)
    setInfoState(EMPTY_CHECKOUT_INFO)
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(STORAGE_KEY)
    }
  }

  function setInfo(next: CheckoutInfo) {
    setInfoState(next)
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    }
  }

  function clear() {
    setInfoState(EMPTY_CHECKOUT_INFO)
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(STORAGE_KEY)
    }
  }

  return (
    <CheckoutContext.Provider
      value={{ info, setInfo, clear, prefillSource, forgetPrefill }}
    >
      {children}
    </CheckoutContext.Provider>
  )
}

export function useCheckout(): CheckoutContextValue {
  const context = useContext(CheckoutContext)
  if (!context) {
    throw new Error('useCheckout must be used within a CheckoutProvider')
  }
  return context
}

import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { COUNTRY_DEFAULT_LANGUAGE } from '#/lib/i18n/translations'

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
  /** 'lalamove' only ever applies to Spades/Metro-Manila/12-4pm — see
   *  lib/checkout/lalamove-eligibility.ts. Its delivery fee is never
   *  charged through this site; it's collected in cash by the rider on
   *  drop-off, so lalamoveEstimatedFeeCents below is informational only. */
  shippingMethod: 'standard' | 'lalamove'
  lalamoveDropoffLat: number | null
  lalamoveDropoffLng: number | null
  lalamoveDropoffAddress: string
  lalamoveEstimatedFeeCents: number | null
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
}

const STORAGE_KEY = 'spades_checkout_info'

/** Falls back to the visitor's geo-detected country (see server/currency/geo.ts
 *  — the same signal CurrencyProvider/LanguageProvider already use) rather
 *  than always defaulting to PH, so a shopper visiting from e.g. Japan
 *  doesn't have to manually change the country field away from the wrong
 *  default. Only kicks in for a fresh checkout with nothing saved yet — a
 *  returning shopper's own choice (including PH) always wins. Restricted to
 *  the markets the site actually has pricing/shipping configured for (the
 *  same five countries the language feature targets — see
 *  COUNTRY_DEFAULT_LANGUAGE) rather than any geo-detected country, since an
 *  unconfigured country wouldn't show up in the checkout's own country
 *  picker (see CountrySelect's countryCodes prop) anyway. */
function readStoredInfo(geoCountry: string | null): CheckoutInfo {
  if (typeof window === 'undefined') return EMPTY_CHECKOUT_INFO
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (raw) return { ...EMPTY_CHECKOUT_INFO, ...JSON.parse(raw) }
  } catch {
    // fall through to the geo default below
  }
  return geoCountry && geoCountry in COUNTRY_DEFAULT_LANGUAGE
    ? { ...EMPTY_CHECKOUT_INFO, country: geoCountry }
    : EMPTY_CHECKOUT_INFO
}

/** NCR has no real province in the PSGC data (see PHAddressFields) — fill in a sensible label before this goes anywhere that requires one (validation, the order's address snapshot). */
export function withSubmittableProvince(info: CheckoutInfo): CheckoutInfo {
  if (info.province || info.region !== 'NATIONAL CAPITAL REGION (NCR)') {
    return info
  }
  return { ...info, province: 'Metro Manila' }
}

/** True once the contact + delivery address fields are all filled in. */
export function isCheckoutInfoComplete(info: CheckoutInfo): boolean {
  const hasCommon = Boolean(
    info.email &&
    info.recipientName &&
    info.phone &&
    info.city &&
    info.addressLine1 &&
    info.postalCode,
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
}

const CheckoutContext = createContext<CheckoutContextValue | null>(null)

export function CheckoutProvider({
  children,
  geoCountry,
}: {
  children: ReactNode
  geoCountry: string | null
}) {
  const [info, setInfoState] = useState<CheckoutInfo>(EMPTY_CHECKOUT_INFO)

  useEffect(() => {
    setInfoState(readStoredInfo(geoCountry))
  }, [geoCountry])

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
    <CheckoutContext.Provider value={{ info, setInfo, clear }}>
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

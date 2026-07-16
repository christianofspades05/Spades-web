import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export interface CheckoutInfo {
  email: string
  recipientName: string
  phone: string
  region: string
  province: string
  city: string
  barangay: string
  postalCode: string
  addressLine1: string
  addressLine2: string
  landmark: string
}

export const EMPTY_CHECKOUT_INFO: CheckoutInfo = {
  email: '',
  recipientName: '',
  phone: '',
  region: '',
  province: '',
  city: '',
  barangay: '',
  postalCode: '',
  addressLine1: '',
  addressLine2: '',
  landmark: '',
}

const STORAGE_KEY = 'spades_checkout_info'

function readStoredInfo(): CheckoutInfo {
  if (typeof window === 'undefined') return EMPTY_CHECKOUT_INFO
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_CHECKOUT_INFO
    return { ...EMPTY_CHECKOUT_INFO, ...JSON.parse(raw) }
  } catch {
    return EMPTY_CHECKOUT_INFO
  }
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
  return Boolean(
    info.email &&
    info.recipientName &&
    info.phone &&
    info.region &&
    info.city &&
    info.barangay &&
    info.addressLine1,
  )
}

interface CheckoutContextValue {
  info: CheckoutInfo
  setInfo: (info: CheckoutInfo) => void
  clear: () => void
}

const CheckoutContext = createContext<CheckoutContextValue | null>(null)

export function CheckoutProvider({ children }: { children: ReactNode }) {
  const [info, setInfoState] = useState<CheckoutInfo>(EMPTY_CHECKOUT_INFO)

  useEffect(() => {
    setInfoState(readStoredInfo())
  }, [])

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

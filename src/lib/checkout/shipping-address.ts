import { formatRegionLabel } from '#/lib/utils/ph-region'
import { formatCountryName } from '#/lib/utils/countries'

/** Shape of the `orders.shipping_address` jsonb snapshot written by
 *  placeOrder (see src/server/checkout/place-order.ts). `country` is
 *  absent on orders placed before international shipping existed — treat
 *  a missing/undefined country as 'PH' (region/province/barangay require
 *  a PH address to have been collected in the first place). */
export interface OrderShippingAddress {
  email: string
  recipientName: string
  phone: string
  country?: string
  region: string
  province: string
  city: string
  barangay: string
  postalCode: string | null
  addressLine1: string
  addressLine2: string | null
  landmark: string | null
}

export function formatShippingAddress(address: OrderShippingAddress): string {
  const country = address.country ?? 'PH'
  if (country === 'PH') {
    return [
      address.addressLine1,
      address.addressLine2,
      address.barangay,
      [address.city, address.province].filter(Boolean).join(', '),
      formatRegionLabel(address.region),
      address.postalCode,
    ]
      .filter((line): line is string => Boolean(line))
      .join(', ')
  }
  return [
    address.addressLine1,
    address.addressLine2,
    [address.city, address.province].filter(Boolean).join(', '),
    address.postalCode,
    formatCountryName(country),
  ]
    .filter((line): line is string => Boolean(line))
    .join(', ')
}

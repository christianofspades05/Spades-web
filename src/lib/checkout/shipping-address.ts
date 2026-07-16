import { formatRegionLabel } from '#/lib/utils/ph-region'

/** Shape of the `orders.shipping_address` jsonb snapshot written by placeOrder (see src/server/checkout/place-order.ts). */
export interface OrderShippingAddress {
  email: string
  recipientName: string
  phone: string
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

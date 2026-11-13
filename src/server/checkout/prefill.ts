/**
 * Contact + default shipping address for a signed-in customer, used to
 * prefill checkout. Returns null for guests (they're prefilled from this
 * device instead — see lib/checkout/returning-customer.ts) and for
 * customers with no saved address.
 */
import { createServerFn } from '@tanstack/react-start'
import { getCurrentCustomer } from '#/lib/auth/session'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type { RememberedCheckoutDetails } from '#/lib/checkout/returning-customer'

export const getCheckoutPrefill = createServerFn({ method: 'GET' }).handler(
  async (): Promise<RememberedCheckoutDetails | null> => {
    const customer = await getCurrentCustomer()
    if (!customer) return null

    const admin = getSupabaseAdminClient()
    const { data: address, error } = await admin
      .from('customer_addresses')
      .select(
        'recipient_name, phone, region, province, city, barangay, postal_code, address_line1, address_line2, landmark',
      )
      .eq('customer_id', customer.id)
      .order('is_default_shipping', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error

    if (!address) {
      // No address book yet — still worth prefilling who they are.
      return {
        email: customer.email,
        recipientName: customer.full_name ?? '',
        phone: customer.phone ?? '',
        country: 'PH',
        region: '',
        province: '',
        city: '',
        barangay: '',
        postalCode: '',
        addressLine1: '',
        addressLine2: '',
        landmark: '',
      }
    }
    return {
      email: customer.email,
      recipientName: address.recipient_name,
      phone: address.phone,
      // The address book is PH-only (see lib/validation/address.ts).
      country: 'PH',
      region: address.region,
      province: address.province,
      city: address.city,
      barangay: address.barangay,
      postalCode: address.postal_code ?? '',
      addressLine1: address.address_line1,
      addressLine2: address.address_line2 ?? '',
      landmark: address.landmark ?? '',
    }
  },
)

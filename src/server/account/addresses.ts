import { createServerFn } from '@tanstack/react-start'
import { philippineAddressSchema } from '#/lib/validation/address'
import { requireCustomer } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type { CustomerAddress } from '#/types/entities'

export const addCustomerAddress = createServerFn({ method: 'POST' })
  .validator(philippineAddressSchema)
  .handler(async ({ data }): Promise<CustomerAddress> => {
    const customer = await requireCustomer()
    const admin = getSupabaseAdminClient()

    if (data.isDefaultShipping) {
      await admin
        .from('customer_addresses')
        .update({ is_default_shipping: false })
        .eq('customer_id', customer.id)
    }
    if (data.isDefaultBilling) {
      await admin
        .from('customer_addresses')
        .update({ is_default_billing: false })
        .eq('customer_id', customer.id)
    }

    const { data: address, error } = await admin
      .from('customer_addresses')
      .insert({
        customer_id: customer.id,
        label: data.label || null,
        recipient_name: data.recipientName,
        phone: data.phone,
        region: data.region,
        province: data.province,
        city: data.city,
        barangay: data.barangay,
        postal_code: data.postalCode || null,
        address_line1: data.addressLine1,
        address_line2: data.addressLine2 || null,
        landmark: data.landmark || null,
        is_default_shipping: data.isDefaultShipping ?? false,
        is_default_billing: data.isDefaultBilling ?? false,
      })
      .select('*')
      .single()
    if (error) throw error
    return address
  })

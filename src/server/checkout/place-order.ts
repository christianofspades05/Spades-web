/**
 * Places an order from the current guest cart. Follows the plan in
 * README.md: recompute everything server-side, reserve stock atomically per
 * line (rolling back on any failure), then create the order/items/payment
 * rows.
 *
 * Two payment paths:
 *   - 'cod': the order is placed immediately, payment is collected on
 *     delivery. Stock stays reserved (not committed) until fulfillment.
 *   - 'online': the order is placed the same way (stock reserved the same
 *     way), but instead of finishing here, a Xendit invoice is created and
 *     its URL returned so the caller can redirect the customer to pay.
 *     src/routes/api/webhooks/xendit.ts commits stock and marks the order
 *     paid once Xendit confirms payment.
 */
import { createServerFn } from '@tanstack/react-start'
import { getRequestUrl } from '@tanstack/react-start/server'
import { placeOrderSchema } from '#/lib/validation/checkout'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { getCartToken } from '#/lib/cart/cart-cookie'
import {
  getActiveVariantStock,
  loadCartWithItems,
} from '#/server/cart/internal'
import { assertDiscountIsRedeemable } from '#/server/cart/discount'
import { shippingCostCents } from '#/lib/checkout/shipping'
import { createXenditInvoice } from '#/lib/xendit/client'
import { sendEmail } from '#/lib/email/resend'
import {
  newOrderEmailHtml,
  newOrderEmailSubject,
} from '#/lib/email/templates/new-order'

export const placeOrder = createServerFn({ method: 'POST' })
  .validator(placeOrderSchema)
  .handler(
    async ({
      data,
    }): Promise<{
      orderId: string
      orderNumber: string
      invoiceUrl: string | null
    }> => {
      const admin = getSupabaseAdminClient()
      const token = getCartToken()
      if (!token) throw new Error('Your cart is empty')

      const { data: cartRow, error: cartLookupError } = await admin
        .from('carts')
        .select('id')
        .eq('session_token', token)
        .eq('status', 'active')
        .maybeSingle()
      if (cartLookupError) throw cartLookupError
      if (!cartRow) throw new Error('Your cart is empty')

      const cart = await loadCartWithItems(admin, cartRow.id)
      if (cart.items.length === 0) throw new Error('Your cart is empty')

      // Re-verify stock right now — the cart's snapshot may be stale.
      for (const item of cart.items) {
        const stock = await getActiveVariantStock(admin, item.variant_id)
        if (!stock || stock.availableStock < item.quantity) {
          throw new Error(
            `"${item.variant.product.name}" no longer has enough stock`,
          )
        }
      }

      // Never trust the client's payment method choice alone — a stale page
      // (or a hand-crafted request) could still submit 'cod' after a staff
      // member restricted it for something in this cart.
      if (data.paymentProvider === 'cod' && !cart.codAvailable) {
        throw new Error(
          'Cash on Delivery is not available for items in your cart. Please pay online instead.',
        )
      }

      // Re-validate the applied discount's usage/date window one more time
      // — it may have expired or hit its cap since it was applied.
      let discountRow: {
        id: string
        times_used: number
      } | null = null
      if (cart.discount) {
        const { data: freshDiscount, error: discountError } = await admin
          .from('discounts')
          .select('*')
          .eq('id', cart.discount.id)
          .single()
        if (discountError) throw discountError
        assertDiscountIsRedeemable(freshDiscount)
        discountRow = freshDiscount
      }

      const subtotalCents = cart.items.reduce(
        (sum, item) => sum + item.quantity * item.price_cents_snapshot,
        0,
      )
      const discountCents = cart.discount?.amountCents ?? 0
      const shippingCents = shippingCostCents(
        data.contact.region,
        subtotalCents - discountCents,
      )
      const totalCents = Math.max(
        0,
        subtotalCents - discountCents + shippingCents,
      )

      const email = data.contact.email.trim().toLowerCase()
      const { data: existingCustomer, error: customerLookupError } = await admin
        .from('customers')
        .select('id')
        .eq('email', email)
        .maybeSingle()
      if (customerLookupError) throw customerLookupError

      let customerId: string
      if (existingCustomer) {
        customerId = existingCustomer.id
        await admin
          .from('customers')
          .update({
            phone: data.contact.phone,
            full_name: data.contact.recipientName,
          })
          .eq('id', customerId)
      } else {
        const { data: newCustomer, error: createCustomerError } = await admin
          .from('customers')
          .insert({
            email,
            phone: data.contact.phone,
            full_name: data.contact.recipientName,
            is_guest: true,
          })
          .select('id')
          .single()
        if (createCustomerError) throw createCustomerError
        customerId = newCustomer.id
      }

      // Reserve stock for every line atomically; unwind on any failure.
      const reserved: { variantId: string; quantity: number }[] = []
      async function releaseAllReserved() {
        for (const r of reserved) {
          await admin.rpc('release_variant_stock', {
            p_variant_id: r.variantId,
            p_quantity: r.quantity,
          })
        }
      }

      try {
        for (const item of cart.items) {
          const { data: ok, error: reserveError } = await admin.rpc(
            'reserve_variant_stock',
            { p_variant_id: item.variant_id, p_quantity: item.quantity },
          )
          if (reserveError) throw reserveError
          if (!ok) {
            throw new Error(`"${item.variant.product.name}" just sold out`)
          }
          reserved.push({ variantId: item.variant_id, quantity: item.quantity })
        }
      } catch (err) {
        await releaseAllReserved()
        throw err
      }

      const shippingAddress = {
        email,
        recipientName: data.contact.recipientName,
        phone: data.contact.phone,
        region: data.contact.region,
        province: data.contact.province,
        city: data.contact.city,
        barangay: data.contact.barangay,
        postalCode: data.contact.postalCode ?? null,
        addressLine1: data.contact.addressLine1,
        addressLine2: data.contact.addressLine2 ?? null,
        landmark: data.contact.landmark ?? null,
      }

      const { data: order, error: orderError } = await admin
        .from('orders')
        .insert({
          customer_id: customerId,
          status: 'pending_payment',
          source: 'storefront',
          subtotal_cents: subtotalCents,
          discount_cents: discountCents,
          shipping_cents: shippingCents,
          total_cents: totalCents,
          discount_id: cart.discount?.id ?? null,
          shipping_address: shippingAddress,
          is_cod: data.paymentProvider === 'cod',
        })
        .select('id, order_number')
        .single()

      if (orderError) {
        await releaseAllReserved()
        throw orderError
      }

      const orderItemsPayload = cart.items.map((item) => {
        const lineSubtotalCents = item.quantity * item.price_cents_snapshot
        const variantLabel = [
          item.variant.size,
          item.variant.color,
          item.variant.style,
        ]
          .filter(Boolean)
          .join(' / ')

        return {
          order_id: order.id,
          variant_id: item.variant_id,
          product_name_snapshot: item.variant.product.name,
          variant_label_snapshot: variantLabel || null,
          sku_snapshot: item.variant.sku,
          unit_price_cents: item.price_cents_snapshot,
          quantity: item.quantity,
          line_subtotal_cents: lineSubtotalCents,
          line_discount_cents: 0,
          line_total_cents: lineSubtotalCents,
        }
      })
      const { error: itemsError } = await admin
        .from('order_items')
        .insert(orderItemsPayload)
      if (itemsError) {
        await releaseAllReserved()
        throw itemsError
      }

      let invoiceUrl: string | null = null

      if (data.paymentProvider === 'cod') {
        const { error: paymentError } = await admin.from('payments').insert({
          order_id: order.id,
          provider: 'cod',
          status: 'pending',
          amount_cents: totalCents,
          idempotency_key: crypto.randomUUID(),
        })
        if (paymentError) throw paymentError
      } else {
        const { data: payment, error: paymentError } = await admin
          .from('payments')
          .insert({
            order_id: order.id,
            provider: 'other',
            status: 'pending',
            amount_cents: totalCents,
            idempotency_key: crypto.randomUUID(),
          })
          .select('id')
          .single()
        if (paymentError) throw paymentError

        const origin = getRequestUrl().origin
        try {
          const invoice = await createXenditInvoice({
            externalId: order.order_number,
            amountPesos: totalCents / 100,
            payerEmail: email,
            description: `Spades order ${order.order_number}`,
            successRedirectUrl: `${origin}/checkout/confirmation?order=${order.order_number}`,
            failureRedirectUrl: `${origin}/checkout/payment?order=${order.order_number}&paymentFailed=true`,
          })
          invoiceUrl = invoice.invoice_url
          await admin
            .from('payments')
            .update({ provider_reference: invoice.id })
            .eq('id', payment.id)
        } catch (err) {
          await releaseAllReserved()
          await admin
            .from('payments')
            .update({ status: 'failed' })
            .eq('id', payment.id)
          await admin
            .from('orders')
            .update({ status: 'failed' })
            .eq('id', order.id)
          throw err
        }
      }

      if (discountRow) {
        await admin
          .from('discounts')
          .update({ times_used: discountRow.times_used + 1 })
          .eq('id', discountRow.id)
      }

      await admin
        .from('carts')
        .update({ status: 'converted' })
        .eq('id', cart.id)

      // Best-effort — a notification failure should never block checkout,
      // and this is silently skipped entirely if no owner address is set.
      const storeOwnerEmail = process.env.STORE_OWNER_EMAIL
      if (storeOwnerEmail) {
        try {
          const origin = getRequestUrl().origin
          await sendEmail({
            to: storeOwnerEmail,
            subject: newOrderEmailSubject(order.order_number),
            html: newOrderEmailHtml({
              orderNumber: order.order_number,
              customerName: data.contact.recipientName,
              customerEmail: email,
              totalCents,
              isCod: data.paymentProvider === 'cod',
              items: cart.items.map((item) => ({
                name: item.variant.product.name,
                variantLabel:
                  [item.variant.size, item.variant.color, item.variant.style]
                    .filter(Boolean)
                    .join(' / ') || null,
                quantity: item.quantity,
              })),
              orderUrl: `${origin}/admin/orders/${order.id}`,
            }),
          })
        } catch (err) {
          console.error('Failed to send new-order notification email:', err)
        }
      }

      return { orderId: order.id, orderNumber: order.order_number, invoiceUrl }
    },
  )

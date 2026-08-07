/**
 * Places an order from the current guest cart. Follows the plan in
 * README.md: recompute everything server-side, reserve stock atomically per
 * line (rolling back on any failure), then create the order/items/payment
 * rows.
 *
 * Two payment paths:
 *   - 'cod': a real order is placed immediately, payment is collected on
 *     delivery. Stock stays reserved (not committed) until fulfillment.
 *   - 'online': NO order is created here. Stock is reserved the same way,
 *     but the checkout snapshot (customer, pricing, address, item lines) is
 *     held in a `checkout_reservations` row instead of `orders` — no order
 *     number, no order row, no "new order" email — while a Xendit invoice
 *     is created and its URL returned so the caller can redirect the
 *     customer to pay. Only once Xendit confirms PAID does
 *     src/routes/api/webhooks/xendit.ts mint the real order (order number
 *     included), commit stock, and send both emails. If the customer
 *     abandons or fails payment, the reservation row is just deleted and
 *     stock released — nothing about the attempt ever touches `orders`.
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
import { applyMarketMarkup } from '#/lib/checkout/market-pricing'
import {
  LALAMOVE_FEE_BUFFER_CENTS,
  isLalamoveEligible,
} from '#/lib/checkout/lalamove-eligibility'
import { getLalamoveQuotation } from '#/lib/lalamove/client'
import type { ExchangeRates } from '#/lib/utils/money'
import type { MarketShippingConfig } from '#/server/storefront/market-pricing'
import type { CheckoutReservationItem, LalamoveInfo } from '#/types/database.types'
import { createXenditInvoice } from '#/lib/xendit/client'
import { getStorefrontScope } from '#/server/storefront/domain'
import { sendEmail, withDisplayName } from '#/lib/email/resend'
import {
  newOrderEmailHtml,
  newOrderEmailSubject,
} from '#/lib/email/templates/new-order'
import {
  orderConfirmationEmailHtml,
  orderConfirmationEmailSubject,
} from '#/lib/email/templates/order-confirmation'

export const placeOrder = createServerFn({ method: 'POST' })
  .validator(placeOrderSchema)
  .handler(
    async ({
      data,
    }): Promise<{
      orderId: string | null
      orderNumber: string | null
      reservationId: string | null
      invoiceUrl: string | null
    }> => {
      const admin = getSupabaseAdminClient()
      const scope = await getStorefrontScope()
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

      // Re-verify stock right now — the cart's snapshot may be stale. Checked
      // in parallel rather than one round-trip per line — with a multi-item
      // cart, doing this sequentially was adding real, avoidable latency to
      // every checkout.
      const stockChecks = await Promise.all(
        cart.items.map((item) => getActiveVariantStock(admin, item.variant_id)),
      )
      cart.items.forEach((item, i) => {
        const stock = stockChecks[i]
        if (!stock || stock.availableStock < item.quantity) {
          throw new Error(
            `"${item.variant.product.name}" no longer has enough stock`,
          )
        }
      })

      // Never trust the client's payment method choice alone — a stale page
      // (or a hand-crafted request) could still submit 'cod' after a staff
      // member restricted it for something in this cart.
      if (data.paymentProvider === 'cod' && !cart.codAvailable) {
        throw new Error(
          'Cash on Delivery is not available for items in your cart. Please pay online instead.',
        )
      }

      // Lalamove is Spades/Metro-Manila/12-4pm-only and online-payment-only
      // — same never-trust-the-client principle as the COD check above.
      const isLalamove = data.contact.shippingMethod === 'lalamove'
      if (isLalamove && data.paymentProvider === 'cod') {
        throw new Error('Lalamove delivery requires online payment.')
      }
      if (
        isLalamove &&
        !isLalamoveEligible({
          brand: scope.brand,
          region: data.contact.region ?? '',
        })
      ) {
        throw new Error(
          'Lalamove delivery is only available for Metro Manila addresses on the Spades store, any day except Sunday.',
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

      const rawSubtotalCents = cart.items.reduce(
        (sum, item) => sum + item.quantity * item.price_cents_snapshot,
        0,
      )
      const discountCents = cart.discount?.amountCents ?? 0

      // Needed both for the flat USD international shipping fallback and
      // for converting a market's own shipping_currency (e.g. SGD) to PHP
      // cents below — re-fetched server-side rather than trusting anything
      // the client computed, same principle as the currency-charging rate
      // lookup further below.
      let exchangeRates: ExchangeRates = {}
      if (data.contact.country !== 'PH') {
        const { data: rateRows } = await admin
          .from('exchange_rates')
          .select('currency, rate_to_php')
        exchangeRates = Object.fromEntries(
          (rateRows ?? []).map((r) => [r.currency, r.rate_to_php]),
        )
      }

      // Per-country product markup (see lib/checkout/market-pricing.ts) —
      // keyed by shipping destination, never by the customer's display
      // currency, and never applied to the shipping fee below. Re-fetched
      // server-side rather than trusting anything the client computed, same
      // principle as the exchange-rate lookup above. `subtotalCents` from
      // here on is the marked-up figure — order_items keep their original
      // (unmarked) per-line snapshot pricing, so `market_markup_percent` is
      // what reconciles orders.subtotal_cents against the item lines for a
      // marked-up international order.
      let marketMarkupPercent: number | undefined
      let marketShipping: MarketShippingConfig | undefined
      if (data.contact.country !== 'PH') {
        const { data: marketRow } = await admin
          .from('markets')
          .select(
            'markup_percent, shipping_price_cents, shipping_currency, free_shipping_min_subtotal_cents, free_shipping_min_items, market_countries!inner(country_code)',
          )
          .eq('is_active', true)
          .eq('market_countries.country_code', data.contact.country)
          .maybeSingle()
        marketMarkupPercent = marketRow?.markup_percent
        if (marketRow) {
          marketShipping = {
            shippingPriceCents: marketRow.shipping_price_cents,
            shippingCurrency: marketRow.shipping_currency,
            freeShippingMinSubtotalCents:
              marketRow.free_shipping_min_subtotal_cents,
            freeShippingMinItems: marketRow.free_shipping_min_items,
          }
        }
      }
      const subtotalCents = applyMarketMarkup(
        rawSubtotalCents,
        marketMarkupPercent,
      )

      const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0)
      let shippingCents = shippingCostCents(
        data.contact.country,
        data.contact.region ?? '',
        subtotalCents - discountCents,
        itemCount,
        exchangeRates,
        marketShipping,
        cart.discount?.excludesFreeShipping ?? false,
      )

      let lalamoveInfo: LalamoveInfo | null = null
      if (isLalamove) {
        const dropoffLat = data.contact.lalamoveDropoffLat
        const dropoffLng = data.contact.lalamoveDropoffLng
        const dropoffAddress = data.contact.lalamoveDropoffAddress
        if (dropoffLat == null || dropoffLng == null || !dropoffAddress) {
          throw new Error('Missing Lalamove delivery pin.')
        }
        // Never trust the client's earlier estimate — a Lalamove quotation
        // is only valid 5 minutes, and checkout may well have taken longer.
        const quotation = await getLalamoveQuotation({
          dropoffLat,
          dropoffLng,
          dropoffAddress,
        })
        lalamoveInfo = {
          quotationId: quotation.quotationId,
          pickupStopId: quotation.pickupStopId,
          dropoffStopId: quotation.dropoffStopId,
          dropoffLat,
          dropoffLng,
          dropoffAddress,
          estimatedFeeCents: quotation.feeCents,
          quotedAt: new Date().toISOString(),
        }
        // Charged same as any other shipping method — the live quote plus
        // a fixed buffer, since the actual trip gets re-quoted (and may
        // differ slightly) when staff book it later. The buffer is the
        // store's cushion against that drift; the customer is never asked
        // for anything more once they've paid this.
        shippingCents = quotation.feeCents + LALAMOVE_FEE_BUFFER_CENTS
      }

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

      // Reserved concurrently, not one row at a time — each RPC call locks
      // only its own variant's row, so there's no cross-item contention to
      // avoid by going sequentially, and a multi-item cart was paying a full
      // network round-trip per line for no benefit.
      const reserveResults = await Promise.all(
        cart.items.map(async (item) => {
          const { data: ok, error } = await admin.rpc('reserve_variant_stock', {
            p_variant_id: item.variant_id,
            p_quantity: item.quantity,
          })
          return { item, ok, error }
        }),
      )

      for (const r of reserveResults) {
        if (!r.error && r.ok) {
          reserved.push({
            variantId: r.item.variant_id,
            quantity: r.item.quantity,
          })
        }
      }

      const failed = reserveResults.find((r) => r.error || !r.ok)
      if (failed) {
        await releaseAllReserved()
        if (failed.error) throw failed.error
        throw new Error(`"${failed.item.variant.product.name}" just sold out`)
      }

      const shippingAddress = {
        email,
        recipientName: data.contact.recipientName,
        phone: data.contact.phone,
        country: data.contact.country,
        region: data.contact.region ?? null,
        province: data.contact.province,
        city: data.contact.city,
        barangay: data.contact.barangay ?? null,
        postalCode: data.contact.postalCode,
        addressLine1: data.contact.addressLine1,
        addressLine2: data.contact.addressLine2 ?? null,
        landmark: data.contact.landmark ?? null,
      }

      // A duplicated product's variants start with a blank SKU (see
      // duplicateProduct) until staff fill one in, and the activation guard
      // in updateProduct is what's supposed to keep a blank-SKU variant
      // from ever going active/sellable — this is the last line of
      // defense against that invariant somehow not holding, since
      // order_items.sku_snapshot is NOT NULL and would otherwise fail the
      // whole checkout with a raw DB error instead of a clear one.
      const missingSku = cart.items.find((item) => !item.variant.sku)
      if (missingSku) {
        throw new Error(
          `"${missingSku.variant.product.name}" isn't available for purchase yet — please remove it from your cart.`,
        )
      }

      const itemsPayload: CheckoutReservationItem[] = cart.items.map((item) => {
        const lineSubtotalCents = item.quantity * item.price_cents_snapshot
        const variantLabel = [
          item.variant.size,
          item.variant.color,
          item.variant.style,
        ]
          .filter(Boolean)
          .join(' / ')

        return {
          variantId: item.variant_id,
          productNameSnapshot: item.variant.product.name,
          variantLabelSnapshot: variantLabel || null,
          skuSnapshot: item.variant.sku!,
          unitPriceCents: item.price_cents_snapshot,
          quantity: item.quantity,
          lineSubtotalCents,
          lineDiscountCents: 0,
          lineTotalCents: lineSubtotalCents,
        }
      })

      const origin = getRequestUrl().origin
      const emailItems = cart.items.map((item) => ({
        name: item.variant.product.name,
        variantLabel:
          [item.variant.size, item.variant.color, item.variant.style]
            .filter(Boolean)
            .join(' / ') || null,
        quantity: item.quantity,
        imageUrl: item.variant.product.images[0] ?? null,
        lineTotalCents: item.quantity * item.price_cents_snapshot,
      }))

      // ---- COD: a real, confirmed order the moment it's placed ----
      if (data.paymentProvider === 'cod') {
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
            is_cod: true,
            currency: data.currency,
            brand: scope.brand,
            market_markup_percent: marketMarkupPercent ?? null,
          })
          .select('id, order_number')
          .single()
        if (orderError) {
          await releaseAllReserved()
          throw orderError
        }

        const orderItemsPayload = itemsPayload.map((item) => ({
          order_id: order.id,
          variant_id: item.variantId,
          product_name_snapshot: item.productNameSnapshot,
          variant_label_snapshot: item.variantLabelSnapshot,
          sku_snapshot: item.skuSnapshot,
          unit_price_cents: item.unitPriceCents,
          quantity: item.quantity,
          line_subtotal_cents: item.lineSubtotalCents,
          line_discount_cents: item.lineDiscountCents,
          line_total_cents: item.lineTotalCents,
        }))
        const { error: itemsError } = await admin
          .from('order_items')
          .insert(orderItemsPayload)
        if (itemsError) {
          await releaseAllReserved()
          throw itemsError
        }

        const { error: paymentError } = await admin.from('payments').insert({
          order_id: order.id,
          provider: 'cod',
          status: 'pending',
          amount_cents: totalCents,
          idempotency_key: crypto.randomUUID(),
        })
        if (paymentError) throw paymentError

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

        // Best-effort and explicitly NOT awaited for both emails below — a
        // Resend outage should never block the customer's checkout response.
        const storeOwnerEmail = process.env.STORE_OWNER_EMAIL
        if (storeOwnerEmail) {
          void sendEmail({
            to: storeOwnerEmail,
            subject: newOrderEmailSubject(order.order_number),
            from: withDisplayName(
              'Spades Official Orders',
              process.env.RESEND_FROM_EMAIL_ORDERS,
            ),
            html: newOrderEmailHtml({
              orderNumber: order.order_number,
              customerName: data.contact.recipientName,
              customerEmail: email,
              totalCents,
              isCod: true,
              items: emailItems,
              orderUrl: `${origin}/admin/orders/${order.id}`,
            }),
          }).catch((err: unknown) => {
            console.error('Failed to send new-order notification email:', err)
          })
        }

        void sendEmail({
          to: email,
          subject: orderConfirmationEmailSubject(order.order_number),
          from: withDisplayName(
            'Spades Official Orders',
            process.env.RESEND_FROM_EMAIL_ORDERS,
          ),
          html: orderConfirmationEmailHtml({
            orderNumber: order.order_number,
            items: emailItems,
            subtotalCents,
            shippingCents,
            discountCents,
            totalCents,
            accountUrl: `${origin}/account`,
          }),
        }).catch((err: unknown) => {
          console.error('Failed to send order confirmation email:', err)
        })

        return {
          orderId: order.id,
          orderNumber: order.order_number,
          reservationId: null,
          invoiceUrl: null,
        }
      }

      // ---- Online payment: nothing enters `orders` until Xendit confirms
      // PAID (see api/webhooks/xendit.ts). Until then this is just a
      // reservation holding the stock + snapshot needed to mint the real
      // order later. ----
      const { data: reservation, error: reservationError } = await admin
        .from('checkout_reservations')
        .insert({
          customer_id: customerId,
          cart_id: cart.id,
          brand: scope.brand,
          currency: data.currency,
          subtotal_cents: subtotalCents,
          discount_cents: discountCents,
          shipping_cents: shippingCents,
          total_cents: totalCents,
          discount_id: cart.discount?.id ?? null,
          market_markup_percent: marketMarkupPercent ?? null,
          shipping_address: shippingAddress,
          items: itemsPayload,
          shipping_method: data.contact.shippingMethod,
          lalamove_info: lalamoveInfo,
        })
        .select('id')
        .single()
      if (reservationError) {
        await releaseAllReserved()
        throw reservationError
      }

      let invoiceUrl: string
      try {
        // Xendit's legacy Invoice API (used here) rejects any currency the
        // merchant hasn't had explicitly enabled on their account — live-
        // tested and confirmed for this account (only PHP is enabled;
        // trying SGD returned "currency SGD is not configured in your
        // settings yet"). So online payment always actually charges PHP
        // regardless of the customer's selected display currency —
        // browsing/checkout/payment-summary still show their chosen
        // currency (see CurrencyContext.tsx), this is only about what
        // Xendit itself is told to charge. If more currencies get enabled
        // on the Xendit side later, this is the one place to start passing
        // data.currency through again (see git history for the previous
        // per-currency attempt).
        const invoice = await createXenditInvoice({
          externalId: reservation.id,
          amount: totalCents / 100,
          currency: 'PHP',
          payerEmail: email,
          description: `${scope.name} order`,
          successRedirectUrl: `${origin}/checkout/confirmation?reservation=${reservation.id}&value=${(totalCents / 100).toFixed(2)}&currency=PHP`,
          failureRedirectUrl: `${origin}/checkout/payment?paymentFailed=true`,
          // Abandoned payments shouldn't leave stock reserved indefinitely —
          // Xendit pushes an EXPIRED webhook event at this point, which
          // releases the reservation (xendit.ts).
          invoiceDuration: 300,
        })
        invoiceUrl = invoice.invoice_url
        await admin
          .from('checkout_reservations')
          .update({ xendit_invoice_id: invoice.id })
          .eq('id', reservation.id)
      } catch (err) {
        await releaseAllReserved()
        await admin
          .from('checkout_reservations')
          .delete()
          .eq('id', reservation.id)
        throw err
      }

      // The cart is spent the moment checkout is attempted, whether or not
      // payment ultimately succeeds — same as the COD path above. If the
      // customer abandons payment and comes back, a fresh cart starts.
      await admin
        .from('carts')
        .update({ status: 'converted' })
        .eq('id', cart.id)

      return {
        orderId: null,
        orderNumber: null,
        reservationId: reservation.id,
        invoiceUrl,
      }
    },
  )

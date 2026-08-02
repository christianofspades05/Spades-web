/**
 * Xendit invoice webhook. Verifies the x-callback-token header against
 * XENDIT_WEBHOOK_VERIFICATION_TOKEN before trusting anything in the body —
 * without that check, anyone who found this URL could POST a fake "PAID"
 * event and get an order marked paid for free.
 *
 * `payload.external_id` is a `checkout_reservations.id` (see
 * server/checkout/place-order.ts — online-payment checkouts never create an
 * `orders` row up front). PAID mints the real order right here — this is
 * the only place an online-payment order number gets minted. EXPIRED/FAILED
 * just releases the reservation's stock and deletes it; nothing ever
 * touches `orders` for an abandoned/failed payment.
 *
 * Idempotent by design: webhook_events is upserted on (source,
 * external_event_id), and — since a reservation is deleted once resolved —
 * a retried event either still finds the reservation (safe to reprocess
 * from scratch) or finds the order it already produced via
 * `orders.external_order_id` and no-ops.
 */
import { createFileRoute } from '@tanstack/react-router'
import type {
  CheckoutReservationItem,
  PaymentProvider,
} from '#/types/database.types'

// Dynamic imports (not top-level) are deliberate: routeTree.gen.ts imports
// every route file — including this one — eagerly so the client can build
// its route tree, and unlike createServerFn, a `server.handlers` route like
// this one doesn't get its server-only code split out of the client bundle
// automatically. A top-level import of admin.ts or xendit/client.ts would
// therefore run their browser guards in every visitor's browser. Importing
// them only inside the handler means that code never loads unless this
// handler actually executes, which only happens server-side.

interface XenditInvoiceWebhookPayload {
  id: string
  external_id: string
  status: string
  payment_channel?: string
  payment_method?: string
  currency?: string
  amount?: number
  [key: string]: unknown
}

function mapPaymentProvider(
  payload: XenditInvoiceWebhookPayload,
): PaymentProvider {
  const channel = (payload.payment_channel ?? '').toUpperCase()
  const method = (payload.payment_method ?? '').toUpperCase()
  if (channel.includes('GCASH')) return 'gcash'
  if (channel.includes('MAYA') || channel.includes('PAYMAYA')) return 'paymaya'
  if (method.includes('CARD') || channel.includes('CARD')) return 'card'
  if (method.includes('BANK') || method.includes('VIRTUAL_ACCOUNT'))
    return 'bank_transfer'
  return 'other'
}

interface ReservationShippingAddress {
  email: string
  recipientName: string
  [key: string]: unknown
}

export const Route = createFileRoute('/api/webhooks/xendit')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isValidXenditWebhookToken } =
          await import('#/lib/xendit/client')
        const { getSupabaseAdminClient } = await import('#/lib/supabase/admin')

        const callbackToken = request.headers.get('x-callback-token')
        if (!isValidXenditWebhookToken(callbackToken)) {
          return new Response('Invalid callback token', { status: 401 })
        }

        const payload = (await request.json()) as XenditInvoiceWebhookPayload
        const admin = getSupabaseAdminClient()

        // Upsert, not insert — Xendit may retry the same event if we didn't
        // respond 200 in time, and (source, external_event_id) is unique.
        await admin.from('webhook_events').upsert(
          {
            source: 'payment_provider',
            event_type: payload.status,
            external_event_id: payload.id,
            payload,
            status: 'processing',
          },
          { onConflict: 'source,external_event_id' },
        )

        try {
          // Resolve external_id against `orders` first — if a real order
          // already exists for it, this event (or an earlier PAID for the
          // same reservation) was already fully processed; no-op.
          const { data: existingOrder, error: existingOrderError } = await admin
            .from('orders')
            .select('id')
            .eq('source', 'storefront')
            .eq('external_order_id', payload.external_id)
            .maybeSingle()
          if (existingOrderError) throw existingOrderError

          if (!existingOrder) {
            const { data: reservation, error: reservationError } = await admin
              .from('checkout_reservations')
              .select('*')
              .eq('id', payload.external_id)
              .maybeSingle()
            if (reservationError) throw reservationError
            if (!reservation) {
              throw new Error(
                `No order or reservation found for external_id ${payload.external_id}`,
              )
            }

            const items = reservation.items

            if (payload.status === 'PAID') {
              const { data: order, error: orderError } = await admin
                .from('orders')
                .insert({
                  customer_id: reservation.customer_id,
                  status: 'paid',
                  source: 'storefront',
                  external_order_id: reservation.id,
                  subtotal_cents: reservation.subtotal_cents,
                  discount_cents: reservation.discount_cents,
                  shipping_cents: reservation.shipping_cents,
                  total_cents: reservation.total_cents,
                  discount_id: reservation.discount_id,
                  shipping_address: reservation.shipping_address,
                  is_cod: false,
                  currency: reservation.currency,
                  brand: reservation.brand,
                  market_markup_percent: reservation.market_markup_percent,
                })
                .select('id, order_number')
                .single()
              if (orderError) throw orderError

              const { error: itemsError } = await admin
                .from('order_items')
                .insert(
                  items.map((item) => ({
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
                  })),
                )
              if (itemsError) throw itemsError

              await Promise.all(
                items
                  .filter(
                    (
                      item,
                    ): item is CheckoutReservationItem & {
                      variantId: string
                    } => item.variantId !== null,
                  )
                  .map((item) =>
                    admin.rpc('commit_variant_stock', {
                      p_variant_id: item.variantId,
                      p_quantity: item.quantity,
                    }),
                  ),
              )

              const { majorUnitsToCents } = await import('#/lib/utils/money')
              // Xendit's payload is the authoritative record of what was
              // actually charged — overwrite our upfront (request-time)
              // estimate with it whenever present, in case the confirmed
              // amount ever differs (e.g. an FX rate that moved between
              // invoice creation and payment).
              const chargedFields =
                payload.currency &&
                payload.currency !== 'PHP' &&
                typeof payload.amount === 'number'
                  ? {
                      charged_currency: payload.currency,
                      charged_amount_cents: majorUnitsToCents(
                        payload.amount,
                        payload.currency,
                      ),
                    }
                  : {}
              const { error: paymentError } = await admin
                .from('payments')
                .insert({
                  order_id: order.id,
                  provider: mapPaymentProvider(payload),
                  provider_reference: payload.id,
                  status: 'captured',
                  amount_cents: reservation.total_cents,
                  idempotency_key: crypto.randomUUID(),
                  captured_at: new Date().toISOString(),
                  ...chargedFields,
                })
              if (paymentError) throw paymentError

              if (reservation.discount_id) {
                const { data: discount } = await admin
                  .from('discounts')
                  .select('times_used')
                  .eq('id', reservation.discount_id)
                  .maybeSingle()
                if (discount) {
                  await admin
                    .from('discounts')
                    .update({ times_used: discount.times_used + 1 })
                    .eq('id', reservation.discount_id)
                }
              }

              await admin
                .from('checkout_reservations')
                .delete()
                .eq('id', reservation.id)

              // Both emails fire only now — an online order isn't real
              // until Xendit reports it PAID (see place-order.ts). The
              // equivalent immediate sends for COD happen right in
              // place-order.ts, since a COD order is real the moment it's
              // placed.
              try {
                const variantIds = Array.from(
                  new Set(
                    items
                      .map((item) => item.variantId)
                      .filter((id): id is string => id !== null),
                  ),
                )
                const { data: variants } =
                  variantIds.length > 0
                    ? await admin
                        .from('product_variants')
                        .select('id, product:products(images)')
                        .in('id', variantIds)
                    : { data: [] }
                const imageByVariantId = new Map(
                  (variants ?? []).map((v) => [
                    v.id,
                    v.product.images[0] ?? null,
                  ]),
                )
                const emailItems = items.map((item) => ({
                  name: item.productNameSnapshot,
                  variantLabel: item.variantLabelSnapshot,
                  quantity: item.quantity,
                  imageUrl: item.variantId
                    ? (imageByVariantId.get(item.variantId) ?? null)
                    : null,
                  lineTotalCents: item.lineTotalCents,
                }))

                const address =
                  reservation.shipping_address as unknown as ReservationShippingAddress
                const siteUrl = process.env.SITE_URL ?? ''
                const { sendEmail, withDisplayName } =
                  await import('#/lib/email/resend')

                const storeOwnerEmail = process.env.STORE_OWNER_EMAIL
                if (storeOwnerEmail) {
                  const { newOrderEmailHtml, newOrderEmailSubject } =
                    await import('#/lib/email/templates/new-order')
                  await sendEmail({
                    to: storeOwnerEmail,
                    subject: newOrderEmailSubject(order.order_number),
                    from: withDisplayName(
                      'Spades Official Orders',
                      process.env.RESEND_FROM_EMAIL_ORDERS,
                    ),
                    html: newOrderEmailHtml({
                      orderNumber: order.order_number,
                      customerName: address.recipientName,
                      customerEmail: address.email,
                      totalCents: reservation.total_cents,
                      isCod: false,
                      items: emailItems,
                      orderUrl: `${siteUrl}/admin/orders/${order.id}`,
                    }),
                  })
                }

                const {
                  orderConfirmationEmailHtml,
                  orderConfirmationEmailSubject,
                } = await import('#/lib/email/templates/order-confirmation')
                await sendEmail({
                  to: address.email,
                  subject: orderConfirmationEmailSubject(order.order_number),
                  from: withDisplayName(
                    'Spades Official Orders',
                    process.env.RESEND_FROM_EMAIL_ORDERS,
                  ),
                  html: orderConfirmationEmailHtml({
                    orderNumber: order.order_number,
                    items: emailItems,
                    subtotalCents: reservation.subtotal_cents,
                    shippingCents: reservation.shipping_cents,
                    discountCents: reservation.discount_cents,
                    totalCents: reservation.total_cents,
                    accountUrl: `${siteUrl}/account`,
                  }),
                })
              } catch (err) {
                console.error(
                  'Failed to send order emails (Xendit webhook):',
                  err,
                )
              }
            } else if (
              payload.status === 'EXPIRED' ||
              payload.status === 'FAILED'
            ) {
              // EXPIRED = the customer never completed payment before the
              // invoice's duration elapsed — an abandoned checkout. FAILED
              // = a payment WAS attempted and Xendit rejected it. Either
              // way, nothing was ever created in `orders`, so there's
              // nothing to cancel — just give the stock back and forget
              // the attempt.
              await Promise.all(
                items
                  .filter(
                    (
                      item,
                    ): item is CheckoutReservationItem & {
                      variantId: string
                    } => item.variantId !== null,
                  )
                  .map((item) =>
                    admin.rpc('release_variant_stock', {
                      p_variant_id: item.variantId,
                      p_quantity: item.quantity,
                    }),
                  ),
              )
              await admin
                .from('checkout_reservations')
                .delete()
                .eq('id', reservation.id)
            }
          }

          await admin
            .from('webhook_events')
            .update({
              status: 'processed',
              processed_at: new Date().toISOString(),
            })
            .eq('source', 'payment_provider')
            .eq('external_event_id', payload.id)
        } catch (err) {
          await admin
            .from('webhook_events')
            .update({
              status: 'failed',
              error_message: err instanceof Error ? err.message : String(err),
            })
            .eq('source', 'payment_provider')
            .eq('external_event_id', payload.id)
          throw err
        }

        return Response.json({ received: true })
      },
    },
  },
})

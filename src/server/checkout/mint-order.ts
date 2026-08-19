/**
 * Mints a real order (order row, order_items, committed stock, a payments
 * row, discount usage increment) from a checkout_reservations row, and
 * sends both order-notification emails. This is the exact sequence that
 * used to live inline in the Xendit webhook's PAID branch — extracted
 * here so PayPal's capture-on-return path (and its own webhook safety
 * net) go through the identical order-creation logic instead of a second
 * hand-copied version drifting out of sync with it.
 *
 * NOT idempotent on its own — every caller is expected to have already
 * checked `orders.external_order_id` for an existing order before calling
 * this (both existing callers do, for their own reasons: Xendit webhook
 * retries, and PayPal's synchronous return path potentially racing its
 * own webhook).
 */
import type { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type { CheckoutReservationItem, Database, PaymentProvider } from '#/types/database.types'

type Admin = ReturnType<typeof getSupabaseAdminClient>
type ReservationRow =
  Database['public']['Tables']['checkout_reservations']['Row']

interface ReservationShippingAddress {
  email: string
  recipientName: string
  [key: string]: unknown
}

export interface MintOrderPayment {
  provider: PaymentProvider
  providerReference: string
  /** Set only when the customer was actually charged in a currency other
   *  than PHP (see payments.charged_currency/charged_amount_cents) —
   *  omit/null for PHP charges, same convention the Xendit webhook
   *  already used. */
  chargedCurrency?: string | null
  chargedAmountCents?: number | null
}

export async function mintOrderFromReservation(
  admin: Admin,
  reservation: ReservationRow,
  payment: MintOrderPayment,
): Promise<{ id: string; orderNumber: string }> {
  const items = reservation.items

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
      shipping_method: reservation.shipping_method,
      lalamove_info: reservation.lalamove_info,
      customer_notes: reservation.customer_notes,
    })
    .select('id, order_number')
    .single()
  if (orderError) throw orderError

  const { error: itemsError } = await admin.from('order_items').insert(
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
        (item): item is CheckoutReservationItem & { variantId: string } =>
          item.variantId !== null,
      )
      .map((item) =>
        admin.rpc('commit_variant_stock', {
          p_variant_id: item.variantId,
          p_quantity: item.quantity,
        }),
      ),
  )

  const { error: paymentError } = await admin.from('payments').insert({
    order_id: order.id,
    provider: payment.provider,
    provider_reference: payment.providerReference,
    status: 'captured',
    amount_cents: reservation.total_cents,
    idempotency_key: crypto.randomUUID(),
    captured_at: new Date().toISOString(),
    ...(payment.chargedCurrency && payment.chargedAmountCents != null
      ? {
          charged_currency: payment.chargedCurrency,
          charged_amount_cents: payment.chargedAmountCents,
        }
      : {}),
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

  await admin.from('checkout_reservations').delete().eq('id', reservation.id)

  // Both emails fire only now — an online order isn't real until payment
  // is actually confirmed (see place-order.ts). The equivalent immediate
  // sends for COD happen right in place-order.ts, since a COD order is
  // real the moment it's placed. Best-effort: a failed send here shouldn't
  // fail order creation, which has already fully happened by this point.
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
      (variants ?? []).map((v) => [v.id, v.product.images[0] ?? null]),
    )
    // Order rows (and reservation.*_cents) are always PHP-denominated
    // internally regardless of what the customer was actually charged (see
    // place-order.ts) — only PayPal orders carry a real charged-currency
    // amount (payments.charged_currency/charged_amount_cents), known only
    // as a single final total. Every PHP component here is scaled by the
    // same ratio so subtotal + shipping - discount still reconciles to the
    // shown total, and the total line itself uses the exact captured
    // amount rather than a scaled-and-rounded approximation of it.
    const emailCurrency = payment.chargedCurrency ?? 'PHP'
    const conversionRatio =
      payment.chargedCurrency &&
      payment.chargedAmountCents != null &&
      reservation.total_cents > 0
        ? payment.chargedAmountCents / reservation.total_cents
        : 1
    const toEmailCurrency = (phpCents: number): number =>
      payment.chargedCurrency ? Math.round(phpCents * conversionRatio) : phpCents
    const emailTotalCents = payment.chargedCurrency
      ? (payment.chargedAmountCents ?? reservation.total_cents)
      : reservation.total_cents

    const emailItems = items.map((item) => ({
      name: item.productNameSnapshot,
      variantLabel: item.variantLabelSnapshot,
      quantity: item.quantity,
      imageUrl: item.variantId
        ? (imageByVariantId.get(item.variantId) ?? null)
        : null,
      lineTotalCents: toEmailCurrency(item.lineTotalCents),
    }))

    const address =
      reservation.shipping_address as unknown as ReservationShippingAddress
    const siteUrl = process.env.SITE_URL ?? ''
    const { inboundReplyToAddress, sendEmail, withDisplayName } =
      await import('#/lib/email/resend')

    const storeOwnerEmail = process.env.STORE_OWNER_EMAIL
    if (storeOwnerEmail) {
      const { newOrderEmailHtml, newOrderEmailSubject } = await import(
        '#/lib/email/templates/new-order'
      )
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
          totalCents: emailTotalCents,
          currency: emailCurrency,
          isCod: false,
          items: emailItems,
          orderUrl: `${siteUrl}/admin/orders/${order.id}`,
        }),
      })
    }

    const { orderConfirmationEmailHtml, orderConfirmationEmailSubject } =
      await import('#/lib/email/templates/order-confirmation')
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
        subtotalCents: toEmailCurrency(reservation.subtotal_cents),
        shippingCents: toEmailCurrency(reservation.shipping_cents),
        discountCents: toEmailCurrency(reservation.discount_cents),
        totalCents: emailTotalCents,
        currency: emailCurrency,
        trackingUrl: `${siteUrl}/track/${order.id}`,
      }),
      replyTo: inboundReplyToAddress(order.id),
    })
  } catch (err) {
    console.error('Failed to send order emails:', err)
  }

  return { id: order.id, orderNumber: order.order_number }
}

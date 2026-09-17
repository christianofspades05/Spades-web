/**
 * Mints a real order (order row, order_items, committed stock, a payments
 * row, discount usage increment) from a checkout_reservations row, and
 * sends both order-notification emails. This is the exact sequence that
 * used to live inline in the Xendit webhook's PAID branch — extracted
 * here so PayPal's capture-on-return path (and its own webhook safety
 * net) go through the identical order-creation logic instead of a second
 * hand-copied version drifting out of sync with it.
 *
 * The database RPC serializes by reservation and commits order, items,
 * stock, payment and discount usage atomically. Retries return the original
 * order without repeating stock changes or notifications.
 */
import type { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type { Database, PaymentProvider } from '#/types/database.types'
import { chargedCurrencyConversion } from '#/lib/utils/money'

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
  rawPayload?: Record<string, unknown>
}

export async function mintOrderFromReservation(
  admin: Admin,
  reservation: ReservationRow,
  payment: MintOrderPayment,
): Promise<{ id: string; orderNumber: string }> {
  const items = reservation.items

  const { data: minted, error: mintError } = await admin.rpc(
    'mint_checkout_order',
    {
      p_reservation_id: reservation.id,
      p_payment: { ...payment },
    },
  )
  if (mintError) throw mintError
  if (!minted.created) return { id: minted.id, orderNumber: minted.orderNumber }
  const order = { id: minted.id, order_number: minted.orderNumber }

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
    const {
      currency: emailCurrency,
      convert: toEmailCurrency,
      totalCents: emailTotalCents,
    } = chargedCurrencyConversion(
      reservation.total_cents,
      payment.chargedCurrency,
      payment.chargedAmountCents,
    )

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

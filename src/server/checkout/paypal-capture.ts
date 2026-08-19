/**
 * Called from checkout/paypal-return.tsx's beforeLoad the moment the
 * customer's browser lands back on our site after approving payment on
 * PayPal — this is the primary confirmation path (unlike Xendit, which is
 * purely webhook-driven; see api/webhooks/paypal.ts for the safety-net
 * fallback covering a customer whose browser never makes it back here).
 *
 * Idempotent: checks for an already-minted order first, so a customer who
 * double-navigates back to this URL (or a race against the webhook) never
 * captures/mints twice — mintOrderFromReservation itself isn't idempotent,
 * this check is what makes the overall flow safe.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { capturePayPalOrder } from '#/lib/paypal/client'
import { majorUnitsToCents } from '#/lib/utils/money'
import { mintOrderFromReservation } from '#/server/checkout/mint-order'
import type {
  CheckoutReservationItem,
  Database,
} from '#/types/database.types'

async function releaseReservationStock(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  reservation: Database['public']['Tables']['checkout_reservations']['Row'],
): Promise<void> {
  await Promise.all(
    reservation.items
      .filter(
        (item): item is CheckoutReservationItem & { variantId: string } =>
          item.variantId !== null,
      )
      .map((item) =>
        admin.rpc('release_variant_stock', {
          p_variant_id: item.variantId,
          p_quantity: item.quantity,
        }),
      ),
  )
  await admin.from('checkout_reservations').delete().eq('id', reservation.id)
}

export type PayPalCaptureResult =
  | { status: 'paid'; orderNumber: string; amount: number; currency: string }
  | { status: 'failed' }

export const capturePayPalCheckout = createServerFn({ method: 'GET' })
  .validator(z.object({ reservationId: z.string().uuid() }))
  .handler(async ({ data }): Promise<PayPalCaptureResult> => {
    const admin = getSupabaseAdminClient()

    const { data: existingOrder, error: existingOrderError } = await admin
      .from('orders')
      .select('order_number, total_cents, currency')
      .eq('source', 'storefront')
      .eq('external_order_id', data.reservationId)
      .maybeSingle()
    if (existingOrderError) throw existingOrderError
    if (existingOrder) {
      return {
        status: 'paid',
        orderNumber: existingOrder.order_number,
        amount: existingOrder.total_cents / 100,
        currency: existingOrder.currency,
      }
    }

    const { data: reservation, error: reservationError } = await admin
      .from('checkout_reservations')
      .select('*')
      .eq('id', data.reservationId)
      .maybeSingle()
    if (reservationError) throw reservationError
    if (!reservation || !reservation.paypal_order_id) {
      return { status: 'failed' }
    }

    const capture = await capturePayPalOrder(reservation.paypal_order_id)
    if (capture.status !== 'COMPLETED') {
      // Rare (e.g. a funding source PayPal declined at capture time,
      // despite the customer approving) — same treatment as Xendit's
      // FAILED webhook branch: give the stock back, forget the attempt.
      await releaseReservationStock(admin, reservation)
      return { status: 'failed' }
    }

    const chargedCurrency =
      capture.currencyCode !== 'PHP' ? capture.currencyCode : null
    const order = await mintOrderFromReservation(admin, reservation, {
      provider: 'paypal',
      providerReference: capture.captureId,
      chargedCurrency,
      chargedAmountCents: chargedCurrency
        ? majorUnitsToCents(Number(capture.amount), chargedCurrency)
        : null,
    })

    return {
      status: 'paid',
      orderNumber: order.orderNumber,
      amount: Number(capture.amount),
      currency: capture.currencyCode,
    }
  })

/**
 * Called from checkout/paypal-cancel.tsx when the customer backs out on
 * PayPal's own page ("Cancel and return to..."). No payment was ever
 * captured at this point — just give the stock back, same as an
 * abandoned/expired Xendit invoice.
 */
export const cancelPayPalCheckout = createServerFn({ method: 'GET' })
  .validator(z.object({ reservationId: z.string().uuid() }))
  .handler(async ({ data }): Promise<void> => {
    const admin = getSupabaseAdminClient()
    const { data: reservation, error } = await admin
      .from('checkout_reservations')
      .select('*')
      .eq('id', data.reservationId)
      .maybeSingle()
    if (error) throw error
    if (!reservation) return
    await releaseReservationStock(admin, reservation)
  })

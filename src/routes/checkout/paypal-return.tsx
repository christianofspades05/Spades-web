/**
 * Where PayPal redirects the customer's browser after they approve payment
 * (see place-order.ts's returnUrl). Captures the payment synchronously
 * right here — this is the primary confirmation path for PayPal checkouts,
 * unlike Xendit's purely webhook-driven flow — then redirects straight to
 * a real order confirmation (no polling needed, unlike Xendit's redirect,
 * since the order is already minted by the time this redirect fires).
 */
import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { capturePayPalCheckout } from '#/server/checkout/paypal-capture'

export const Route = createFileRoute('/checkout/paypal-return')({
  validateSearch: z.object({ reservation: z.string().uuid() }),
  beforeLoad: async ({ search }) => {
    const result = await capturePayPalCheckout({
      data: { reservationId: search.reservation },
    })
    if (result.status === 'failed') {
      throw redirect({
        to: '/checkout/payment',
        search: { paymentFailed: true },
      })
    }
    throw redirect({
      to: '/checkout/confirmation',
      search: {
        order: result.orderNumber,
        value: result.amount,
        currency: result.currency,
      },
    })
  },
})

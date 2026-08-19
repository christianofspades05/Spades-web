/**
 * Where PayPal redirects the customer's browser if they back out on
 * PayPal's own approval page ("Cancel and return to...") instead of
 * approving (see place-order.ts's cancelUrl). Releases the stock held for
 * the abandoned attempt, then sends them back to try paying again.
 */
import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { cancelPayPalCheckout } from '#/server/checkout/paypal-capture'

export const Route = createFileRoute('/checkout/paypal-cancel')({
  validateSearch: z.object({ reservation: z.string().uuid() }),
  beforeLoad: async ({ search }) => {
    await cancelPayPalCheckout({ data: { reservationId: search.reservation } })
    throw redirect({
      to: '/checkout/payment',
      search: { paymentFailed: true },
    })
  },
})

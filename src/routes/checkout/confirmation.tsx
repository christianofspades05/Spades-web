import { useEffect } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { useCheckout } from '#/lib/checkout/CheckoutContext'
import { trackPixelEvent } from '#/lib/analytics/facebook-pixel'
import { buttonPrimaryClassName } from '#/components/storefront/ui'

export const Route = createFileRoute('/checkout/confirmation')({
  validateSearch: z.object({
    order: z.string().optional(),
    // Order total in pesos (not cents) — threaded through the redirect URL
    // from place-order.ts (Xendit's successRedirectUrl) and payment.tsx (the
    // direct COD path) since this page has no other way to know the value of
    // an order it never itself fetches, for the Purchase pixel event below.
    value: z.coerce.number().optional(),
  }),
  component: ConfirmationPage,
})

const FIRED_PURCHASE_KEY = 'spades_fb_purchase_fired'

function ConfirmationPage() {
  const { order, value } = Route.useSearch()
  const { clear } = useCheckout()

  // Reached either directly (COD) or via Xendit's success redirect (online
  // payment) — either way the checkout is done, so reset it for next time.
  useEffect(() => {
    clear()
  }, [])

  // Guards against double-counting the same order as a second Purchase if
  // the customer refreshes or revisits this confirmation URL.
  useEffect(() => {
    if (!order || value === undefined) return
    const fired = new Set(
      JSON.parse(sessionStorage.getItem(FIRED_PURCHASE_KEY) ?? '[]') as string[],
    )
    if (fired.has(order)) return
    fired.add(order)
    sessionStorage.setItem(FIRED_PURCHASE_KEY, JSON.stringify([...fired]))
    trackPixelEvent('Purchase', { value, currency: 'PHP' })
  }, [order, value])

  return (
    <div className="mx-auto max-w-2xl px-6 py-20 text-center">
      <h1 className="text-3xl font-black tracking-tight">Order placed!</h1>
      {order && (
        <p className="mt-3 text-lg text-neutral-700 dark:text-neutral-300">
          Order <span className="font-semibold">{order}</span>
        </p>
      )}
      <p className="mt-4 text-neutral-600 dark:text-neutral-400">
        Thanks for your order — we'll text and email you updates as it's packed
        and shipped.
      </p>
      <Link
        to="/products"
        search={{ sort: 'newest', page: 1 }}
        className={`${buttonPrimaryClassName} mx-auto mt-8 w-fit`}
      >
        Continue shopping
      </Link>
    </div>
  )
}

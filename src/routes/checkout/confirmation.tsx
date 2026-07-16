import { useEffect } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { useCheckout } from '#/lib/checkout/CheckoutContext'
import { buttonPrimaryClassName } from '#/components/storefront/ui'

export const Route = createFileRoute('/checkout/confirmation')({
  validateSearch: z.object({ order: z.string().optional() }),
  component: ConfirmationPage,
})

function ConfirmationPage() {
  const { order } = Route.useSearch()
  const { clear } = useCheckout()

  // Reached either directly (COD) or via Xendit's success redirect (online
  // payment) — either way the checkout is done, so reset it for next time.
  useEffect(() => {
    clear()
  }, [])

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

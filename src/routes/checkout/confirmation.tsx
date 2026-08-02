import { useEffect } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { useCheckout } from '#/lib/checkout/CheckoutContext'
import { trackPixelEvent } from '#/lib/analytics/facebook-pixel'
import { buttonPrimaryClassName } from '#/components/storefront/ui'
import { getOrderConfirmation } from '#/server/checkout/confirmation'
import { formatCentsAsPHP } from '#/lib/utils/money'

export const Route = createFileRoute('/checkout/confirmation')({
  validateSearch: z.object({
    order: z.string().optional(),
    // Order total in major units of `currency` (not minor units/cents) —
    // threaded through the redirect URL from place-order.ts (Xendit's
    // successRedirectUrl) and payment.tsx (the direct COD path) since this
    // page has no other way to know the value of an order it never itself
    // fetches, for the Purchase pixel event below.
    value: z.coerce.number().optional(),
    // The currency `value` is actually denominated in — the currency the
    // customer was actually charged, not necessarily their browse-time
    // display currency (COD/GCash/Maya/bank transfer always charge PHP
    // regardless of what was selected).
    currency: z.string().default('PHP'),
  }),
  loaderDeps: ({ search }) => ({ order: search.order }),
  loader: async ({ deps }) => {
    if (!deps.order) return { confirmation: null }
    const confirmation = await getOrderConfirmation({
      data: { orderNumber: deps.order },
    })
    return { confirmation }
  },
  component: ConfirmationPage,
})

const FIRED_PURCHASE_KEY = 'spades_fb_purchase_fired'

function ConfirmationPage() {
  const { order, value, currency } = Route.useSearch()
  const { confirmation } = Route.useLoaderData()
  const items = confirmation?.items ?? []
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
      JSON.parse(
        sessionStorage.getItem(FIRED_PURCHASE_KEY) ?? '[]',
      ) as string[],
    )
    if (fired.has(order)) return
    fired.add(order)
    sessionStorage.setItem(FIRED_PURCHASE_KEY, JSON.stringify([...fired]))
    trackPixelEvent('Purchase', { value, currency })
  }, [order, value, currency])

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

      {items.length > 0 && (
        <div className="mt-8 flex flex-col gap-3 text-left">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
            >
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt=""
                  className="size-14 shrink-0 rounded object-cover"
                />
              ) : (
                <div className="size-14 shrink-0 rounded bg-neutral-200 dark:bg-neutral-800" />
              )}
              <div className="min-w-0">
                <p className="truncate font-medium text-neutral-900 dark:text-white">
                  {item.productName}
                </p>
                {item.variantLabel && (
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    {item.variantLabel}
                  </p>
                )}
              </div>
              <p className="ml-auto shrink-0 text-neutral-600 dark:text-neutral-400">
                ×{item.quantity}
              </p>
            </div>
          ))}
          {confirmation && (
            <div className="flex flex-col gap-1.5 border-t border-neutral-200 pt-3 text-sm dark:border-neutral-800">
              <div className="flex items-center justify-between text-neutral-600 dark:text-neutral-400">
                <span>Subtotal</span>
                <span>{formatCentsAsPHP(confirmation.subtotalCents)}</span>
              </div>
              {confirmation.discountCents > 0 && (
                <div className="flex items-center justify-between text-neutral-600 dark:text-neutral-400">
                  <span>Discount</span>
                  <span>−{formatCentsAsPHP(confirmation.discountCents)}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-neutral-600 dark:text-neutral-400">
                <span>Shipping</span>
                <span>
                  {confirmation.shippingCents === 0
                    ? 'Free'
                    : formatCentsAsPHP(confirmation.shippingCents)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between border-t border-neutral-200 pt-1.5 font-semibold text-neutral-900 dark:border-neutral-800 dark:text-white">
                <span>Total</span>
                <span>{formatCentsAsPHP(confirmation.totalCents)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      <Link
        to="/products"
        search={{ sort: 'stock_desc', page: 1 }}
        className={`${buttonPrimaryClassName} mx-auto mt-8 w-fit`}
      >
        Continue shopping
      </Link>
    </div>
  )
}

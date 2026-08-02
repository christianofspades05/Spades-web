import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { useCheckout } from '#/lib/checkout/CheckoutContext'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import { trackPixelEvent } from '#/lib/analytics/facebook-pixel'
import { buttonPrimaryClassName } from '#/components/storefront/ui'
import {
  getOrderConfirmation,
  getOrderConfirmationByReservation,
} from '#/server/checkout/confirmation'
import type { OrderConfirmation } from '#/server/checkout/confirmation'
import { formatCentsAsPHP } from '#/lib/utils/money'

export const Route = createFileRoute('/checkout/confirmation')({
  validateSearch: z.object({
    order: z.string().optional(),
    // Set instead of `order` for an online payment redirected here by
    // Xendit — at that point no order exists yet (see place-order.ts), only
    // the checkout_reservations row that becomes one once the webhook
    // reports PAID. See the polling effect below.
    reservation: z.string().optional(),
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
  loaderDeps: ({ search }) => ({
    order: search.order,
    reservation: search.reservation,
  }),
  loader: async ({ deps }) => {
    if (deps.order) {
      const confirmation = await getOrderConfirmation({
        data: { orderNumber: deps.order },
      })
      return {
        kind: 'order' as const,
        orderNumber: deps.order,
        confirmation,
      }
    }
    if (deps.reservation) {
      const result = await getOrderConfirmationByReservation({
        data: { reservationId: deps.reservation },
      })
      return {
        kind: 'reservation' as const,
        reservationId: deps.reservation,
        result,
      }
    }
    return { kind: 'none' as const }
  },
  component: ConfirmationPage,
})

const FIRED_PURCHASE_KEY = 'spades_fb_purchase_fired'
const POLL_INTERVAL_MS = 1500
const MAX_POLL_ATTEMPTS = 20

interface Resolved {
  orderNumber: string
  confirmation: OrderConfirmation | null
}

function ConfirmationPage() {
  const { value, currency } = Route.useSearch()
  const loaderData = Route.useLoaderData()
  const { clear } = useCheckout()
  const { t } = useLanguage()

  const [resolved, setResolved] = useState<Resolved | null>(() => {
    if (loaderData.kind === 'order') {
      return {
        orderNumber: loaderData.orderNumber,
        confirmation: loaderData.confirmation,
      }
    }
    if (
      loaderData.kind === 'reservation' &&
      loaderData.result.status === 'paid'
    ) {
      return {
        orderNumber: loaderData.result.orderNumber,
        confirmation: loaderData.result.confirmation,
      }
    }
    return null
  })
  const [pollTimedOut, setPollTimedOut] = useState(false)

  // Reached either directly (COD) or via Xendit's success redirect (online
  // payment) — either way the checkout is done, so reset it for next time.
  useEffect(() => {
    clear()
  }, [])

  // Xendit's webhook (which mints the real order) runs async and isn't
  // guaranteed to land before this redirect does — poll briefly until it
  // has. Normally resolves within a second or two.
  useEffect(() => {
    if (resolved || loaderData.kind !== 'reservation') return
    let cancelled = false
    let attempts = 0
    const id = setInterval(() => {
      attempts += 1
      getOrderConfirmationByReservation({
        data: { reservationId: loaderData.reservationId },
      }).then((result) => {
        if (cancelled) return
        if (result.status === 'paid') {
          setResolved({
            orderNumber: result.orderNumber,
            confirmation: result.confirmation,
          })
          clearInterval(id)
        } else if (attempts >= MAX_POLL_ATTEMPTS) {
          setPollTimedOut(true)
          clearInterval(id)
        }
      })
    }, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [loaderData, resolved])

  // Guards against double-counting the same order as a second Purchase if
  // the customer refreshes or revisits this confirmation URL.
  useEffect(() => {
    if (!resolved || value === undefined) return
    const orderNumber = resolved.orderNumber
    const fired = new Set(
      JSON.parse(
        sessionStorage.getItem(FIRED_PURCHASE_KEY) ?? '[]',
      ) as string[],
    )
    if (fired.has(orderNumber)) return
    fired.add(orderNumber)
    sessionStorage.setItem(FIRED_PURCHASE_KEY, JSON.stringify([...fired]))
    trackPixelEvent('Purchase', { value, currency })
  }, [resolved, value, currency])

  const items = resolved?.confirmation?.items ?? []
  const confirmation = resolved?.confirmation ?? null
  const stillConfirming = loaderData.kind === 'reservation' && !resolved

  return (
    <div className="mx-auto max-w-2xl px-6 py-20 text-center">
      <h1 className="text-3xl font-black tracking-tight">
        {t.confirmation.orderPlaced}
      </h1>
      {stillConfirming ? (
        <p className="mt-3 text-lg text-neutral-700 dark:text-neutral-300">
          {pollTimedOut
            ? t.confirmation.stillConfirmingPayment
            : t.confirmation.confirmingPayment}
        </p>
      ) : (
        resolved && (
          <p className="mt-3 text-lg text-neutral-700 dark:text-neutral-300">
            {t.confirmation.order}{' '}
            <span className="font-semibold">{resolved.orderNumber}</span>
          </p>
        )
      )}
      <p className="mt-4 text-neutral-600 dark:text-neutral-400">
        {t.confirmation.thanksMessage}
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
                <span>{t.payment.subtotal}</span>
                <span>{formatCentsAsPHP(confirmation.subtotalCents)}</span>
              </div>
              {confirmation.discountCents > 0 && (
                <div className="flex items-center justify-between text-neutral-600 dark:text-neutral-400">
                  <span>{t.payment.discount}</span>
                  <span>−{formatCentsAsPHP(confirmation.discountCents)}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-neutral-600 dark:text-neutral-400">
                <span>{t.payment.shipping}</span>
                <span>
                  {confirmation.shippingCents === 0
                    ? t.checkout.free
                    : formatCentsAsPHP(confirmation.shippingCents)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between border-t border-neutral-200 pt-1.5 font-semibold text-neutral-900 dark:border-neutral-800 dark:text-white">
                <span>{t.payment.total}</span>
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
        {t.confirmation.continueShopping}
      </Link>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { useCart } from '#/lib/cart/CartContext'
import {
  isCheckoutInfoComplete,
  useCheckout,
  withSubmittableProvince,
} from '#/lib/checkout/CheckoutContext'
import { shippingCostCents } from '#/lib/checkout/shipping'
import { formatRegionLabel } from '#/lib/utils/ph-region'
import { placeOrder } from '#/server/checkout/place-order'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import { buttonPrimaryClassName } from '#/components/storefront/ui'

export const Route = createFileRoute('/checkout/payment')({
  validateSearch: z.object({
    order: z.string().optional(),
    paymentFailed: z.boolean().optional(),
  }),
  component: PaymentPage,
})

type PaymentMethod = 'cod' | 'online'

function PaymentPage() {
  const { cart, subtotalCents, discountCents, isLoading, codAvailable } =
    useCart()
  const { info, clear } = useCheckout()
  const { paymentFailed } = Route.useSearch()
  const navigate = useNavigate()
  const [method, setMethod] = useState<PaymentMethod>('cod')
  const [placing, setPlacing] = useState(false)
  const [error, setError] = useState<string | null>(
    paymentFailed
      ? 'Your online payment didn’t go through. You can try again or choose Cash on Delivery instead.'
      : null,
  )

  useEffect(() => {
    if (!codAvailable && method === 'cod') setMethod('online')
  }, [codAvailable, method])

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-neutral-500 dark:text-neutral-400">
        Loading...
      </div>
    )
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-bold">Your cart is empty</h1>
        <Link
          to="/products"
          search={{ sort: 'newest', page: 1 }}
          className={`${buttonPrimaryClassName} mx-auto mt-6 w-fit`}
        >
          Continue shopping
        </Link>
      </div>
    )
  }

  if (!isCheckoutInfoComplete(info)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-bold">Missing delivery details</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Please fill in your contact and delivery information first.
        </p>
        <Link
          to="/checkout"
          className={`${buttonPrimaryClassName} mx-auto mt-6 w-fit`}
        >
          Back to checkout
        </Link>
      </div>
    )
  }

  const shippingCents = shippingCostCents(
    info.region,
    subtotalCents - discountCents,
  )
  const totalCents = Math.max(0, subtotalCents - discountCents + shippingCents)
  const addressLines = [
    info.addressLine1,
    info.addressLine2,
    info.barangay,
    [info.city, info.province].filter(Boolean).join(', '),
    formatRegionLabel(info.region),
  ].filter(Boolean)

  async function handlePlaceOrder() {
    setError(null)
    setPlacing(true)
    try {
      const result = await placeOrder({
        data: {
          contact: withSubmittableProvince(info),
          paymentProvider: method,
        },
      })
      if (result.invoiceUrl) {
        // Cart/checkout state is only cleared once payment is actually
        // confirmed (the webhook), not here — the customer may bounce back
        // from Xendit without finishing.
        window.location.href = result.invoiceUrl
        return
      }
      clear()
      void navigate({
        to: '/checkout/confirmation',
        search: {
          order: result.orderNumber,
          value: (totalCents / 100).toFixed(2),
        },
      })
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setPlacing(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight">Payment</h1>

      <section className="mt-8 rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Deliver to
          </h2>
          <Link
            to="/checkout"
            className="text-sm text-neutral-600 underline hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"
          >
            Edit
          </Link>
        </div>
        <p className="mt-2 text-sm text-neutral-900 dark:text-white">
          {info.recipientName}
        </p>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {info.phone}
        </p>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          {addressLines.join(', ')}
        </p>
      </section>

      <section className="mt-8">
        <h2 className="mb-4 text-lg font-semibold">Payment method</h2>
        <div className="space-y-2">
          <label
            className={`flex items-center gap-3 rounded-md border-2 px-4 py-3 ${
              !codAvailable ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
            } ${
              method === 'cod'
                ? 'border-neutral-900 bg-neutral-50 dark:border-white dark:bg-neutral-900'
                : 'border-neutral-200 dark:border-neutral-800'
            }`}
          >
            <input
              type="radio"
              name="payment"
              disabled={!codAvailable}
              checked={method === 'cod'}
              onChange={() => setMethod('cod')}
            />
            <span className="flex-1 text-sm font-medium text-neutral-900 dark:text-white">
              Cash on Delivery (COD)
              {!codAvailable && (
                <span className="mt-0.5 block text-xs font-normal text-neutral-500 dark:text-neutral-400">
                  Not available for items in your cart — pay online instead.
                </span>
              )}
            </span>
          </label>

          <label
            className={`flex cursor-pointer items-center gap-3 rounded-md border-2 px-4 py-3 ${
              method === 'online'
                ? 'border-neutral-900 bg-neutral-50 dark:border-white dark:bg-neutral-900'
                : 'border-neutral-200 dark:border-neutral-800'
            }`}
          >
            <input
              type="radio"
              name="payment"
              checked={method === 'online'}
              onChange={() => setMethod('online')}
            />
            <span className="flex-1 text-sm font-medium text-neutral-900 dark:text-white">
              Pay Online — GCash, Maya, Cards, Bank Transfer
            </span>
          </label>
        </div>
      </section>

      <section className="mt-8 space-y-2 rounded-lg bg-neutral-50 p-5 text-sm dark:bg-neutral-900">
        <div className="flex items-center justify-between">
          <span className="text-neutral-600 dark:text-neutral-400">
            Subtotal
          </span>
          <span className="font-medium">{formatCentsAsPHP(subtotalCents)}</span>
        </div>
        {discountCents > 0 && (
          <div className="flex items-center justify-between text-green-700 dark:text-green-400">
            <span>Discount</span>
            <span>-{formatCentsAsPHP(discountCents)}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-neutral-600 dark:text-neutral-400">
            Shipping
          </span>
          <span className="font-medium">
            {shippingCents === 0 ? 'Free' : formatCentsAsPHP(shippingCents)}
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-neutral-200 pt-2 text-base font-semibold dark:border-neutral-800">
          <span>Total</span>
          <span>{formatCentsAsPHP(totalCents)}</span>
        </div>
      </section>

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={placing}
        onClick={handlePlaceOrder}
        className={`${buttonPrimaryClassName} mt-6 w-full justify-center`}
      >
        {placing
          ? method === 'online'
            ? 'Redirecting to payment...'
            : 'Placing order...'
          : method === 'online'
            ? `Continue to pay — ${formatCentsAsPHP(totalCents)}`
            : `Place order — ${formatCentsAsPHP(totalCents)}`}
      </button>
    </div>
  )
}

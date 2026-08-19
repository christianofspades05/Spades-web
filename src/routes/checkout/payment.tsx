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
import { applyMarketMarkup } from '#/lib/checkout/market-pricing'
import { LALAMOVE_FEE_BUFFER_CENTS } from '#/lib/checkout/lalamove-eligibility'
import {
  getActiveMarketMarkups,
  getActiveMarketShipping,
} from '#/server/storefront/market-pricing'
import { formatRegionLabel } from '#/lib/utils/ph-region'
import { formatCountryName } from '#/lib/utils/countries'
import { placeOrder } from '#/server/checkout/place-order'
import { useCurrency } from '#/lib/currency/CurrencyContext'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import { buttonPrimaryClassName } from '#/components/storefront/ui'

export const Route = createFileRoute('/checkout/payment')({
  validateSearch: z.object({
    order: z.string().optional(),
    paymentFailed: z.boolean().optional(),
  }),
  loader: async () => ({
    marketMarkups: await getActiveMarketMarkups(),
    marketShipping: await getActiveMarketShipping(),
  }),
  component: PaymentPage,
})

type PaymentMethod = 'cod' | 'online'

function PaymentPage() {
  const { marketMarkups, marketShipping } = Route.useLoaderData()
  const { currency, rates, formatPrice } = useCurrency()
  const { t } = useLanguage()
  const {
    cart,
    subtotalCents: rawSubtotalCents,
    discountCents,
    isLoading,
    codAvailable,
    codUnavailableReason,
  } = useCart()
  const { info, clear } = useCheckout()
  const { paymentFailed } = Route.useSearch()
  const navigate = useNavigate()
  const [method, setMethod] = useState<PaymentMethod>('cod')
  const [placing, setPlacing] = useState(false)
  const [error, setError] = useState<string | null>(
    paymentFailed ? t.payment.paymentFailedError : null,
  )

  const isLalamove = info.shippingMethod === 'lalamove'
  // Shown next to a disabled (not hidden) COD option so the customer knows
  // why, rather than it just silently not being there.
  const codDisabledReason =
    info.country !== 'PH'
      ? 'Cash on Delivery is only available for Philippine addresses — please pay online.'
      : isLalamove
        ? 'Not available for Lalamove delivery — online payment only.'
        : !codAvailable
          ? (codUnavailableReason ??
            'Cash on Delivery is not available for items in your cart.')
          : null

  useEffect(() => {
    // Lalamove is online-payment-only, same as any other COD restriction —
    // never trust the client alone, place-order.ts re-checks this too.
    if (codDisabledReason && method === 'cod') setMethod('online')
  }, [codDisabledReason, method])

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-neutral-500 dark:text-neutral-400">
        {t.cart.loading}
      </div>
    )
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-bold">{t.cart.empty}</h1>
        <Link
          to="/products"
          search={{ sort: 'stock_desc', page: 1 }}
          className={`${buttonPrimaryClassName} mx-auto mt-6 w-fit`}
        >
          {t.cart.continueShopping}
        </Link>
      </div>
    )
  }

  if (!isCheckoutInfoComplete(info)) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-bold">{t.payment.missingDeliveryTitle}</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          {t.payment.missingDeliveryBody}
        </p>
        <Link
          to="/checkout"
          className={`${buttonPrimaryClassName} mx-auto mt-6 w-fit`}
        >
          {t.payment.backToCheckout}
        </Link>
      </div>
    )
  }

  // Per-country product markup (see lib/checkout/market-pricing.ts) — keyed
  // by shipping destination, never touches the shipping fee below. Must
  // stay in sync with place-order.ts's own markup lookup, or the customer
  // would see one total here and be charged another.
  const subtotalCents = applyMarketMarkup(
    rawSubtotalCents,
    marketMarkups[info.country],
  )

  const shippingCents = shippingCostCents(
    info.country,
    info.region,
    subtotalCents - discountCents,
    cart.items.reduce((sum, item) => sum + item.quantity, 0),
    rates,
    marketShipping[info.country],
    cart.discount?.excludesFreeShipping ?? false,
  )
  // Lalamove's delivery fee is charged same as any other shipping method —
  // the live quote plus a fixed buffer (see place-order.ts, which fetches
  // its own fresh quote at order time rather than trusting this estimate).
  const chargedShippingCents = isLalamove
    ? (info.lalamoveEstimatedFeeCents ?? 0) + LALAMOVE_FEE_BUFFER_CENTS
    : shippingCents
  const totalCents = Math.max(
    0,
    subtotalCents - discountCents + chargedShippingCents,
  )
  const addressLines =
    info.country === 'PH'
      ? [
          info.addressLine1,
          info.addressLine2,
          info.barangay,
          [info.city, info.province].filter(Boolean).join(', '),
          formatRegionLabel(info.region),
        ].filter(Boolean)
      : [
          info.addressLine1,
          info.addressLine2,
          [info.city, info.province].filter(Boolean).join(', '),
          info.postalCode,
          formatCountryName(info.country),
        ].filter(Boolean)

  async function handlePlaceOrder() {
    setError(null)
    setPlacing(true)
    try {
      const result = await placeOrder({
        data: {
          contact: withSubmittableProvince(info),
          paymentProvider: method,
          currency: method === 'cod' ? 'PHP' : currency,
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
          // Always set here — this branch only runs for COD, which always
          // returns a real order number (see place-order.ts).
          order: result.orderNumber ?? undefined,
          value: (totalCents / 100).toFixed(2),
          currency: 'PHP',
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
      <h1 className="text-2xl font-bold tracking-tight">{t.payment.title}</h1>

      <section className="mt-8 rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {t.payment.deliverTo}
          </h2>
          <Link
            to="/checkout"
            className="text-sm text-neutral-600 underline hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"
          >
            {t.payment.edit}
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
        <h2 className="mb-4 text-lg font-semibold">
          {t.payment.paymentMethod}
        </h2>
        <div className="space-y-2">
          <label
            className={`flex items-center gap-3 rounded-md border-2 px-4 py-3 ${
              codDisabledReason
                ? 'cursor-not-allowed border-neutral-200 opacity-50 dark:border-neutral-800'
                : method === 'cod'
                  ? 'cursor-pointer border-neutral-900 bg-neutral-50 dark:border-white dark:bg-neutral-900'
                  : 'cursor-pointer border-neutral-200 dark:border-neutral-800'
            }`}
          >
            <input
              type="radio"
              name="payment"
              disabled={!!codDisabledReason}
              checked={method === 'cod'}
              onChange={() => setMethod('cod')}
            />
            <span className="flex-1 text-sm font-medium text-neutral-900 dark:text-white">
              {t.payment.cod}
              {codDisabledReason && (
                <span className="block text-xs font-normal text-neutral-500 dark:text-neutral-400">
                  {codDisabledReason}
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
              {info.country === 'PH'
                ? t.payment.payOnline
                : t.payment.payOnlinePayPal}
              {/* Only Xendit (Philippine addresses) actually forces PHP
                  regardless of display currency — PayPal (every other
                  country) genuinely charges the customer's own selected
                  currency, so this "you'll be charged the PHP equivalent"
                  notice would be actively wrong there. See
                  server/checkout/place-order.ts's provider routing. */}
              {info.country === 'PH' && currency !== 'PHP' && (
                <span className="mt-0.5 block text-xs font-normal text-neutral-500 dark:text-neutral-400">
                  {t.payment.pricesShownIn(currency)},{' '}
                  {formatCentsAsPHP(totalCents)}.
                </span>
              )}
            </span>
          </label>
        </div>
      </section>

      <section className="mt-8 space-y-2 rounded-lg bg-neutral-50 p-5 text-sm dark:bg-neutral-900">
        <div className="flex items-center justify-between">
          <span className="text-neutral-600 dark:text-neutral-400">
            {t.payment.subtotal}
          </span>
          <span className="font-medium">{formatPrice(subtotalCents)}</span>
        </div>
        {discountCents > 0 && (
          <div className="flex items-center justify-between text-green-700 dark:text-green-400">
            <span>{t.payment.discount}</span>
            <span>-{formatPrice(discountCents)}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-neutral-600 dark:text-neutral-400">
            {t.payment.shipping}
          </span>
          <span className="font-medium">
            {isLalamove
              ? formatPrice(chargedShippingCents)
              : shippingCents === 0
                ? t.checkout.free
                : formatPrice(shippingCents)}
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-neutral-200 pt-2 text-base font-semibold dark:border-neutral-800">
          <span>{t.payment.total}</span>
          <span>{formatPrice(totalCents)}</span>
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
            ? t.payment.redirecting
            : t.payment.placingOrder
          : method === 'online'
            ? t.payment.continueToPay(formatPrice(totalCents))
            : t.payment.placeOrder(formatPrice(totalCents))}
      </button>
    </div>
  )
}

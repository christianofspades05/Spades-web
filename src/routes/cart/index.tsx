import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useCart } from '#/lib/cart/CartContext'
import { useCurrency } from '#/lib/currency/CurrencyContext'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import { getErrorMessage } from '#/lib/utils/errors'
import { FreeShippingNudge } from '#/components/storefront/FreeShippingNudge'
import { CartStockWarning } from '#/components/storefront/CartStockWarning'
import { trackCheckoutEvent } from '#/lib/analytics/checkout-tracking'
import { readSavedCheckoutDestination } from '#/lib/checkout/CheckoutContext'
import { estimateCartShipping } from '#/lib/checkout/cart-shipping-estimate'
import type { CartShippingEstimate } from '#/lib/checkout/cart-shipping-estimate'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
} from '#/components/storefront/ui'

export const Route = createFileRoute('/cart/')({
  component: CartPage,
})

function CartPage() {
  const {
    formatPriceWithMarkup: formatPrice,
    formatPrice: formatPlainPrice,
    freeShippingProgressForBrowsing,
    browsingCountry,
  } = useCurrency()
  const { storefrontScope } = Route.useRouteContext()
  const { t } = useLanguage()
  const {
    cart,
    subtotalCents,
    discountCents,
    totalCents,
    itemCount,
    isLoading,
    updateQuantity,
    removeItem,
    applyDiscountCode,
    removeDiscountCode,
  } = useCart()
  const [error, setError] = useState<string | null>(null)
  const [discountInput, setDiscountInput] = useState('')
  const [discountError, setDiscountError] = useState<string | null>(null)
  const [applyingDiscount, setApplyingDiscount] = useState(false)
  // Read after mount (sessionStorage isn't available during SSR) — a
  // destination the shopper already entered at checkout this session.
  const [savedDestination, setSavedDestination] =
    useState<ReturnType<typeof readSavedCheckoutDestination>>(null)
  useEffect(() => {
    setSavedDestination(readSavedCheckoutDestination())
  }, [])

  const cartId = cart?.id ?? null
  const hasItems = (cart?.items.length ?? 0) > 0
  useEffect(() => {
    if (!cartId || !hasItems) return
    trackCheckoutEvent({
      cartId,
      eventType: 'cart_view',
      brand: storefrontScope.brand,
      metadata: {
        item_count: itemCount,
        subtotal_cents: subtotalCents,
        source: 'cart_page',
      },
    })
    // Once per cart per session (trackCheckoutEvent dedupes) — only needs
    // to run when a cart with items first shows up.
  }, [cartId, hasItems])

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-neutral-500 dark:text-neutral-400">
        {t.cart.loading}
      </div>
    )
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
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

  async function handleQuantityChange(cartItemId: string, quantity: number) {
    setError(null)
    try {
      if (quantity <= 0) {
        await removeItem(cartItemId)
      } else {
        await updateQuantity(cartItemId, quantity)
      }
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  async function handleRemove(cartItemId: string) {
    setError(null)
    try {
      await removeItem(cartItemId)
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  async function handleApplyDiscount(event: React.FormEvent) {
    event.preventDefault()
    if (!discountInput.trim()) return
    setDiscountError(null)
    setApplyingDiscount(true)
    try {
      await applyDiscountCode(discountInput)
      setDiscountInput('')
    } catch (err) {
      setDiscountError(getErrorMessage(err))
    } finally {
      setApplyingDiscount(false)
    }
  }

  async function handleRemoveDiscount() {
    setDiscountError(null)
    try {
      await removeDiscountCode()
    } catch (err) {
      setDiscountError(getErrorMessage(err))
    }
  }

  const discount = cart.discount
  const shippingEstimate: CartShippingEstimate = estimateCartShipping({
    country: savedDestination?.country ?? browsingCountry,
    region: savedDestination?.region ?? '',
    province: savedDestination?.province ?? '',
    subtotalAfterDiscountCents: subtotalCents - discountCents,
    itemCount,
    excludeFreeShipping: discount?.excludesFreeShipping ?? false,
  })
  const shippingKnown =
    shippingEstimate.kind === 'free' || shippingEstimate.kind === 'exact'
  const shippingCents =
    shippingEstimate.kind === 'exact' ? shippingEstimate.cents : 0
  // Shipping is only ever estimated for PH (see estimateCartShipping), and
  // is only added to the total once it's known exactly — otherwise the
  // total is labelled "before shipping" so it never looks like the final
  // charge.
  const grandTotalLabel = formatPrice(totalCents + shippingCents)
  const shippingLabel =
    shippingEstimate.kind === 'free'
      ? t.cart.shippingFree
      : shippingEstimate.kind === 'exact'
        ? formatPlainPrice(shippingEstimate.cents)
        : shippingEstimate.kind === 'from'
          ? t.cart.shippingFrom(formatPlainPrice(shippingEstimate.cents))
          : t.cart.shippingAtCheckout

  function handleCheckoutClick() {
    if (!cart) return
    trackCheckoutEvent({
      cartId: cart.id,
      eventType: 'cart_checkout_clicked',
      brand: storefrontScope.brand,
      metadata: {
        item_count: itemCount,
        subtotal_cents: subtotalCents,
        source: 'cart_page',
      },
    })
  }

  function formatDiscountRate(type: string, value: number): string {
    return type === 'fixed_amount' ? `${formatPrice(value)} off` : `${value}% off`
  }
  const discountLabel = discount
    ? discount.type === 'free_shipping'
      ? t.cart.freeShippingLabel
      : formatDiscountRate(discount.type, discount.value)
    : null

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-bold tracking-tight">{t.cart.title}</h1>

      <CartStockWarning issues={cart.stockIssues} className="mt-4" />

      {error && (
        <p className="mt-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}

      <ul className="mt-8 divide-y divide-neutral-200 dark:divide-neutral-800">
        {cart.items.map((item) => {
          const variantLabel = [
            item.variant.size,
            item.variant.color,
            item.variant.style,
          ]
            .filter(Boolean)
            .join(' / ')
          const imageUrl = item.variant.product.images[0]
          const itemDiscount = discount?.itemBreakdown.find(
            (b) => b.cartItemId === item.id,
          )
          const discountedUnits = itemDiscount?.discountedUnits ?? 0
          const lineTotalCents = item.quantity * item.price_cents_snapshot
          // Uses this item's own discountedAmountCents (not a blanket
          // percentage) since a stacked discount may not cover every item
          // the same way — see AppliedCartDiscount.itemBreakdown's doc
          // comment.
          const discountedLineCents = itemDiscount
            ? lineTotalCents - itemDiscount.discountedAmountCents
            : null

          return (
            <li key={item.id} className="flex gap-4 py-5">
              <div className="h-24 w-20 shrink-0 overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-900">
                {imageUrl && (
                  <img
                    src={imageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
              </div>

              <div className="flex flex-1 flex-col justify-between">
                <div>
                  <p className="font-medium text-neutral-900 dark:text-white">
                    {item.variant.product.name}
                  </p>
                  {variantLabel && (
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                      {variantLabel}
                    </p>
                  )}
                  {item.variant.is_pre_order && (
                    <>
                      <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-400">
                        Pre-Order
                      </span>
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        {item.variant.pre_order_arrival_note ||
                          'Ships within 10 days'}
                      </p>
                    </>
                  )}
                  {discountedUnits > 0 && (
                    <p className="text-xs font-medium text-green-700 dark:text-green-400">
                      {t.cart.discountAppliesTo(discountedUnits, item.quantity)}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleQuantityChange(item.id, item.quantity - 1)
                      }
                      className="h-7 w-7 rounded-full border border-neutral-300 text-sm hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-white"
                    >
                      −
                    </button>
                    <span className="w-6 text-center text-sm">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleQuantityChange(item.id, item.quantity + 1)
                      }
                      className="h-7 w-7 rounded-full border border-neutral-300 text-sm hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-white"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(item.id)}
                    className="text-sm text-neutral-400 hover:text-neutral-900 dark:text-neutral-500 dark:hover:text-white"
                  >
                    {t.cart.remove}
                  </button>
                </div>
              </div>

              {discountedLineCents != null ? (
                <div className="whitespace-nowrap text-right">
                  <p className="text-sm text-neutral-400 line-through dark:text-neutral-600">
                    {formatPrice(lineTotalCents)}
                  </p>
                  <p className="font-medium text-green-700 dark:text-green-400">
                    {formatPrice(discountedLineCents)}
                  </p>
                </div>
              ) : (
                <p className="whitespace-nowrap font-medium text-neutral-900 dark:text-white">
                  {formatPrice(lineTotalCents)}
                </p>
              )}
            </li>
          )
        })}
      </ul>

      <div className="mt-8 border-t border-neutral-200 pt-6 dark:border-neutral-800">
        {/* Only a real customer-entered code gets the "applied [Remove]"
            treatment — an automatic store-wide/collection sale isn't
            something the customer did, so it just shows up in the price
            breakdown below instead, with no banner to remove. */}
        {discount?.code ? (
          <div className="mb-5 flex items-center justify-between rounded-md bg-green-50 px-4 py-3 dark:bg-green-950/30">
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                {t.cart.applied(discount.code)}
              </p>
              <p className="text-xs text-green-700 dark:text-green-400">
                {discountLabel}
                {discount.stackedWith.map((stacked) => (
                  <span key={stacked.title}>
                    {' '}
                    {t.cart.stackedWithSale(stacked.title)} (
                    {formatDiscountRate(stacked.type, stacked.value)})
                  </span>
                ))}
              </p>
            </div>
            <button
              type="button"
              onClick={handleRemoveDiscount}
              className="text-sm text-green-700 underline hover:text-green-900 dark:text-green-400 dark:hover:text-green-200"
            >
              {t.cart.remove}
            </button>
          </div>
        ) : (
          <form onSubmit={handleApplyDiscount} className="mb-5 flex gap-2">
            <input
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value)}
              placeholder={t.cart.discountCodePlaceholder}
              className={`${inputClassName} flex-1`}
            />
            <button
              type="submit"
              disabled={applyingDiscount}
              className={buttonSecondaryClassName}
            >
              {applyingDiscount ? t.cart.applying : t.cart.apply}
            </button>
          </form>
        )}
        {discountError && (
          <p className="mb-5 text-sm text-red-700 dark:text-red-400">
            {discountError}
          </p>
        )}

        <div className="flex items-center justify-between">
          <span className="text-neutral-600 dark:text-neutral-400">
            {t.cart.subtotal}
          </span>
          <span className="font-medium text-neutral-900 dark:text-white">
            {formatPrice(subtotalCents)}
          </span>
        </div>
        {discountCents > 0 && (
          <div className="mt-2 flex items-center justify-between text-green-700 dark:text-green-400">
            <span>{t.cart.discount}</span>
            <span>-{formatPrice(discountCents)}</span>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-neutral-600 dark:text-neutral-400">
            {t.cart.shipping}
          </span>
          <span
            className={
              shippingEstimate.kind === 'free'
                ? 'font-medium text-green-700 dark:text-green-400'
                : 'text-neutral-900 dark:text-white'
            }
          >
            {shippingLabel}
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-neutral-200 pt-3 text-lg font-semibold dark:border-neutral-800">
          <span>
            {shippingKnown ? t.cart.total : t.cart.totalBeforeShipping}
          </span>
          <span>{grandTotalLabel}</span>
        </div>
      </div>

      <FreeShippingNudge
        progress={freeShippingProgressForBrowsing(
          subtotalCents - discountCents,
          itemCount,
        )}
        className="mt-6 mb-2 text-center text-xs font-medium text-neutral-600 dark:text-neutral-400"
      />

      {/* Desktop: inline, full width under the summary. */}
      <div className="mt-6 hidden sm:block">
        <Link
          to="/checkout"
          onClick={handleCheckoutClick}
          className={`${buttonPrimaryClassName} w-full! py-4! text-base!`}
        >
          {t.cart.checkout}
        </Link>
      </div>

      {/* Mobile: pinned to the bottom of the screen with the total, so the
          next step is always one thumb-tap away however long the cart is.
          The spacer keeps the last bit of the page from hiding behind it. */}
      <div className="h-24 sm:hidden" aria-hidden="true" />
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden dark:border-neutral-800 dark:bg-neutral-950/95">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-neutral-600 dark:text-neutral-400">
            {shippingKnown ? t.cart.total : t.cart.totalBeforeShipping}
          </span>
          <span className="font-semibold text-neutral-900 dark:text-white">
            {grandTotalLabel}
          </span>
        </div>
        <Link
          to="/checkout"
          onClick={handleCheckoutClick}
          className={`${buttonPrimaryClassName} w-full! py-4! text-base!`}
        >
          {t.cart.checkout}
        </Link>
      </div>
    </div>
  )
}

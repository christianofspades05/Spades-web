import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useCart } from '#/lib/cart/CartContext'
import {
  useCheckout,
  withSubmittableProvince,
} from '#/lib/checkout/CheckoutContext'
import {
  checkoutContactBaseSchema,
  checkoutContactSchema,
} from '#/lib/validation/checkout'
import { saveCartEmail } from '#/server/cart/mutations'
import {
  freeShippingProgress,
  shippingCostCents,
  shippingZoneForRegion,
} from '#/lib/checkout/shipping'
import type { ShippingZone } from '#/lib/checkout/shipping'
import { applyMarketMarkup } from '#/lib/checkout/market-pricing'
import {
  LALAMOVE_FEE_BUFFER_CENTS,
  isLalamoveAvailableToday,
  isLalamoveRegionEligible,
} from '#/lib/checkout/lalamove-eligibility'
import {
  getActiveMarketMarkups,
  getActiveMarketShipping,
} from '#/server/storefront/market-pricing'
import { getLalamoveEstimate } from '#/server/checkout/lalamove'
import { useCurrency } from '#/lib/currency/CurrencyContext'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import {
  centsToMajorUnits,
  convertCents,
  effectiveCurrency,
  formatCentsAsPHP,
} from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import { trackPixelEvent } from '#/lib/analytics/facebook-pixel'
import { PHAddressFields } from '#/components/storefront/PHAddressFields'
import { CountrySelect } from '#/components/storefront/CountrySelect'
import { FreeShippingNudge } from '#/components/storefront/FreeShippingNudge'
import { LalamoveAddressPicker } from '#/components/storefront/LalamoveAddressPicker'
import {
  buttonPrimaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/storefront/ui'

// PH-domestic standard shipping label, by zone — includes an estimated
// delivery window so the customer knows what "Standard shipping" actually
// means for their address, not just what it costs.
const PH_STANDARD_SHIPPING_LABELS: Record<ShippingZone, string> = {
  metro_manila: 'Metro Manila - 2-3 days delivery',
  luzon: 'Luzon - 2-5 days delivery',
  visayas: 'Visayas - 5-10 days delivery',
  mindanao: 'Mindanao - 7-10 days delivery',
}

function standardShippingLabel(
  country: string,
  region: string,
  fallback: string,
): string {
  return country === 'PH'
    ? PH_STANDARD_SHIPPING_LABELS[shippingZoneForRegion(region)]
    : fallback
}

export const Route = createFileRoute('/checkout/')({
  loader: async () => ({
    marketMarkups: await getActiveMarketMarkups(),
    marketShipping: await getActiveMarketShipping(),
  }),
  component: CheckoutPage,
})

/** Delivery pin + live fee estimate for the Lalamove shipping option — kept
 *  as its own component so re-fetching the estimate on pin move doesn't
 *  re-render the whole checkout page. The estimate is informational only;
 *  place-order.ts always fetches its own fresh quotation at order time. */
function LalamoveDeliveryPicker() {
  const { info, setInfo } = useCheckout()
  const [estimating, setEstimating] = useState(false)
  const [estimateError, setEstimateError] = useState<string | null>(null)

  const pin =
    info.lalamoveDropoffLat != null && info.lalamoveDropoffLng != null
      ? { lat: info.lalamoveDropoffLat, lng: info.lalamoveDropoffLng }
      : null
  const searchHint = [info.addressLine1, info.barangay, info.city, info.province]
    .filter(Boolean)
    .join(', ')

  useEffect(() => {
    if (!pin) return
    let cancelled = false
    setEstimating(true)
    setEstimateError(null)
    getLalamoveEstimate({
      data: {
        dropoffLat: pin.lat,
        dropoffLng: pin.lng,
        dropoffAddress: info.lalamoveDropoffAddress || searchHint,
      },
    })
      .then((result) => {
        if (cancelled) return
        setInfo({
          ...info,
          lalamoveEstimatedFeeCents: result.estimatedFeeCents,
        })
      })
      .catch((err: unknown) => {
        if (!cancelled) setEstimateError(getErrorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setEstimating(false)
      })
    return () => {
      cancelled = true
    }
    // Re-estimates only when the pin itself moves — info/setInfo change on
    // every keystroke elsewhere in the form and would otherwise refire this.
  }, [pin?.lat, pin?.lng])

  return (
    <div className="space-y-3 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
      <LalamoveAddressPicker
        pin={pin}
        onPinChange={(next) =>
          setInfo({
            ...info,
            lalamoveDropoffLat: next.lat,
            lalamoveDropoffLng: next.lng,
            lalamoveDropoffAddress: searchHint,
          })
        }
        searchHint={searchHint}
      />
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        {estimating
          ? 'Getting delivery estimate…'
          : estimateError
            ? estimateError
            : info.lalamoveEstimatedFeeCents != null
              ? `Lalamove delivery fee: ${formatCentsAsPHP(info.lalamoveEstimatedFeeCents + LALAMOVE_FEE_BUFFER_CENTS)} — included in your total.`
              : 'Drop a pin above to get an estimated delivery fee.'}
      </p>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        Orders placed 4PM–11:59PM are booked the next day at 10AM. Orders
        placed 12AM–9:59AM are booked starting 10AM.
      </p>
    </div>
  )
}

function CheckoutPage() {
  const { marketMarkups, marketShipping } = Route.useLoaderData()
  const { storefrontScope } = Route.useRouteContext()
  const { currency, rates, formatPrice } = useCurrency()
  const { t } = useLanguage()
  const {
    cart,
    subtotalCents: rawSubtotalCents,
    discountCents,
    isLoading,
  } = useCart()
  const { info, setInfo } = useCheckout()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  const firedInitiateCheckout = useRef(false)
  useEffect(() => {
    if (isLoading || !cart || cart.items.length === 0) return
    if (firedInitiateCheckout.current) return
    firedInitiateCheckout.current = true
    const target = effectiveCurrency(currency, rates)
    trackPixelEvent('InitiateCheckout', {
      content_ids: cart.items.map((item) => item.variant.product_id),
      content_type: 'product',
      num_items: cart.items.reduce((sum, item) => sum + item.quantity, 0),
      value: centsToMajorUnits(
        convertCents(rawSubtotalCents - discountCents, target, rates),
        target,
      ),
      currency: target,
    })
  }, [isLoading, cart, rawSubtotalCents, discountCents, currency, rates])

  const lalamoveRegionEligible = isLalamoveRegionEligible({
    brand: storefrontScope.brand,
    region: info.region,
  })
  const lalamoveAvailableToday = isLalamoveAvailableToday()
  const lalamoveEligible = lalamoveRegionEligible && lalamoveAvailableToday

  // If the region changes away from Metro Manila (or it becomes Sunday)
  // while Lalamove is selected, fall back to standard rather than
  // letting the customer proceed with a no-longer-valid choice — place-order
  // would reject it anyway, but this catches it before they even try. Placed
  // before the early returns below (with every other hook in this
  // component) — hooks can't be called conditionally.
  useEffect(() => {
    if (info.shippingMethod === 'lalamove' && !lalamoveEligible) {
      setInfo({ ...info, shippingMethod: 'standard' })
    }
  }, [lalamoveEligible])

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-16 text-neutral-500 dark:text-neutral-400">
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

  // Per-country product markup (see lib/checkout/market-pricing.ts) — keyed
  // by shipping destination, never touches the shipping fee below. Must
  // stay in sync with place-order.ts's own markup lookup, or the customer
  // would see one total here and be charged another.
  const subtotalCents = applyMarketMarkup(
    rawSubtotalCents,
    marketMarkups[info.country],
  )

  const shippingCents =
    info.country !== 'PH' || info.region
      ? shippingCostCents(
          info.country,
          info.region,
          subtotalCents - discountCents,
          cart.items.reduce((sum, item) => sum + item.quantity, 0),
          rates,
          marketShipping[info.country],
          cart.discount?.excludesFreeShipping ?? false,
        )
      : null
  // Lalamove's delivery fee is charged through this site same as any other
  // shipping method — the live quote plus a fixed buffer (see place-order.ts,
  // which fetches its own fresh quote at order time rather than trusting
  // this estimate) rather than what shippingCostCents() would've charged
  // for a standard delivery to the same address.
  const chargedShippingCents =
    info.shippingMethod === 'lalamove'
      ? (info.lalamoveEstimatedFeeCents ?? 0) + LALAMOVE_FEE_BUFFER_CENTS
      : (shippingCents ?? 0)
  const totalCents = subtotalCents - discountCents + chargedShippingCents

  function handleCountryChange(country: string) {
    setInfo({
      ...info,
      country,
      region: '',
      province: '',
      city: '',
      barangay: '',
      // Lalamove never applies outside PH/Metro Manila — falling back to
      // standard rather than leaving a now-invalid selection in place.
      shippingMethod: 'standard',
    })
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const submittable = withSubmittableProvince(info)
    const result = checkoutContactSchema.safeParse(submittable)
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Please check your details')
      return
    }
    setInfo(submittable)
    void navigate({ to: '/checkout/payment' })
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight">{t.checkout.title}</h1>

      <form
        onSubmit={handleSubmit}
        className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_380px]"
      >
        <div className="space-y-8">
          <section>
            <h2 className="mb-4 text-lg font-semibold">{t.checkout.contact}</h2>
            <label className={labelClassName}>
              {t.checkout.email}
              <input
                type="email"
                required
                value={info.email}
                onChange={(e) => setInfo({ ...info, email: e.target.value })}
                onBlur={(e) => {
                  const result =
                    checkoutContactBaseSchema.shape.email.safeParse(
                      e.target.value,
                    )
                  if (!result.success) return
                  void saveCartEmail({ data: { email: result.data } }).catch(
                    () => {},
                  )
                }}
                className={inputClassName}
              />
            </label>
          </section>

          <section>
            <h2 className="mb-4 text-lg font-semibold">{t.checkout.delivery}</h2>
            <div className="space-y-4">
              <div className={labelClassName}>
                {t.checkout.country}
                <CountrySelect
                  value={info.country}
                  onChange={handleCountryChange}
                  countryCodes={['PH', ...Object.keys(marketMarkups)]}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className={labelClassName}>
                  {t.checkout.recipientName}
                  <input
                    required
                    value={info.recipientName}
                    onChange={(e) =>
                      setInfo({ ...info, recipientName: e.target.value })
                    }
                    className={inputClassName}
                  />
                </label>
                <label className={labelClassName}>
                  {t.checkout.phone}
                  <input
                    required
                    placeholder={
                      info.country === 'PH' ? '09171234567' : undefined
                    }
                    value={info.phone}
                    onChange={(e) =>
                      setInfo({ ...info, phone: e.target.value })
                    }
                    className={inputClassName}
                  />
                </label>
              </div>

              {info.country === 'PH' ? (
                <PHAddressFields
                  value={{
                    region: info.region,
                    province: info.province,
                    city: info.city,
                    barangay: info.barangay,
                  }}
                  onChange={(addr) => setInfo({ ...info, ...addr })}
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className={labelClassName}>
                    {t.checkout.city}
                    <input
                      required
                      value={info.city}
                      onChange={(e) =>
                        setInfo({ ...info, city: e.target.value })
                      }
                      className={inputClassName}
                    />
                  </label>
                  <label className={labelClassName}>
                    {t.checkout.stateProvince}
                    <input
                      required
                      value={info.province}
                      onChange={(e) =>
                        setInfo({ ...info, province: e.target.value })
                      }
                      className={inputClassName}
                    />
                  </label>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className={labelClassName}>
                  {t.checkout.addressLine1}
                  <input
                    required
                    placeholder={t.checkout.addressLine1Placeholder}
                    value={info.addressLine1}
                    onChange={(e) =>
                      setInfo({ ...info, addressLine1: e.target.value })
                    }
                    className={inputClassName}
                  />
                </label>
                <label className={labelClassName}>
                  {t.checkout.addressLine2Optional}
                  <input
                    value={info.addressLine2}
                    onChange={(e) =>
                      setInfo({ ...info, addressLine2: e.target.value })
                    }
                    className={inputClassName}
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className={labelClassName}>
                  {t.checkout.landmarkOptional}
                  <input
                    value={info.landmark}
                    onChange={(e) =>
                      setInfo({ ...info, landmark: e.target.value })
                    }
                    className={inputClassName}
                  />
                </label>
                <label className={labelClassName}>
                  {t.checkout.postalCode}
                  <input
                    required
                    value={info.postalCode}
                    onChange={(e) =>
                      setInfo({ ...info, postalCode: e.target.value })
                    }
                    className={inputClassName}
                  />
                </label>
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-4 text-lg font-semibold">
              {t.checkout.shippingMethod}
            </h2>
            {shippingCents == null ? (
              <p className="rounded-md bg-neutral-50 px-4 py-3 text-sm text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                {t.checkout.selectRegionPrompt}
              </p>
            ) : lalamoveRegionEligible ? (
              <div className="space-y-3">
                <label
                  className={`flex cursor-pointer items-center justify-between rounded-md border-2 px-4 py-3 text-sm ${
                    info.shippingMethod === 'standard'
                      ? 'border-neutral-900 bg-neutral-50 dark:border-white dark:bg-neutral-900'
                      : 'border-neutral-200 dark:border-neutral-800'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="shippingMethod"
                      checked={info.shippingMethod === 'standard'}
                      onChange={() =>
                        setInfo({ ...info, shippingMethod: 'standard' })
                      }
                    />
                    <span className="font-medium text-neutral-900 dark:text-white">
                      {standardShippingLabel(
                        info.country,
                        info.region,
                        t.checkout.standardShipping,
                      )}
                    </span>
                  </span>
                  <span className="font-medium text-neutral-900 dark:text-white">
                    {shippingCents === 0
                      ? t.checkout.free
                      : formatPrice(shippingCents)}
                  </span>
                </label>

                <label
                  className={`flex items-center justify-between gap-3 rounded-md border-2 px-4 py-3 text-sm ${
                    !lalamoveAvailableToday
                      ? 'cursor-not-allowed border-neutral-200 opacity-50 dark:border-neutral-800'
                      : info.shippingMethod === 'lalamove'
                        ? 'cursor-pointer border-neutral-900 bg-neutral-50 dark:border-white dark:bg-neutral-900'
                        : 'cursor-pointer border-neutral-200 dark:border-neutral-800'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="shippingMethod"
                      disabled={!lalamoveAvailableToday}
                      checked={info.shippingMethod === 'lalamove'}
                      onChange={() =>
                        setInfo({ ...info, shippingMethod: 'lalamove' })
                      }
                    />
                    <span className="font-medium text-neutral-900 dark:text-white">
                      Lalamove Same-day Delivery (10AM–4PM, Metro Manila only)
                      {!lalamoveAvailableToday && (
                        <span className="block text-xs font-normal text-neutral-500 dark:text-neutral-400">
                          Not available on Sundays.
                        </span>
                      )}
                    </span>
                  </span>
                  {info.lalamoveEstimatedFeeCents != null && (
                    <span className="font-medium whitespace-nowrap text-neutral-900 dark:text-white">
                      {formatCentsAsPHP(
                        info.lalamoveEstimatedFeeCents +
                          LALAMOVE_FEE_BUFFER_CENTS,
                      )}
                    </span>
                  )}
                </label>

                {info.shippingMethod === 'lalamove' &&
                  lalamoveAvailableToday && <LalamoveDeliveryPicker />}
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-md border border-neutral-900 bg-neutral-50 px-4 py-3 text-sm dark:border-white dark:bg-neutral-900">
                <span className="font-medium text-neutral-900 dark:text-white">
                  {standardShippingLabel(
                    info.country,
                    info.region,
                    t.checkout.standardShipping,
                  )}
                </span>
                <span className="font-medium text-neutral-900 dark:text-white">
                  {shippingCents === 0 ? t.checkout.free : formatPrice(shippingCents)}
                </span>
              </div>
            )}
            {info.shippingMethod !== 'lalamove' && (
              <FreeShippingNudge
                progress={freeShippingProgress(
                  info.country,
                  subtotalCents - discountCents,
                  cart.items.reduce((sum, item) => sum + item.quantity, 0),
                  marketShipping[info.country],
                  cart.discount?.excludesFreeShipping ?? false,
                )}
                className="mt-3 text-center text-xs font-medium text-neutral-600 dark:text-neutral-400"
              />
            )}
          </section>

          {error && (
            <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            className={`${buttonPrimaryClassName} w-full justify-center`}
          >
            {t.checkout.continueToPayment}
          </button>
        </div>

        <aside className="h-fit rounded-lg bg-neutral-50 p-6 dark:bg-neutral-900">
          <ul className="space-y-4">
            {cart.items.map((item) => {
              const variantLabel = [
                item.variant.size,
                item.variant.color,
                item.variant.style,
              ]
                .filter(Boolean)
                .join(' / ')
              const imageUrl = item.variant.product.images[0]
              const discountedUnits =
                cart.discount?.itemBreakdown.find(
                  (b) => b.cartItemId === item.id,
                )?.discountedUnits ?? 0
              return (
                <li key={item.id} className="flex gap-3">
                  <div className="relative h-16 w-14 shrink-0 overflow-hidden rounded-md bg-neutral-200 dark:bg-neutral-800">
                    {imageUrl && (
                      <img
                        src={imageUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    )}
                    <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-semibold text-white dark:bg-white dark:text-neutral-950">
                      {item.quantity}
                    </span>
                  </div>
                  <div className="flex flex-1 items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-neutral-900 dark:text-white">
                        {item.variant.product.name}
                      </p>
                      {variantLabel && (
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">
                          {variantLabel}
                        </p>
                      )}
                      {discountedUnits > 0 && (
                        <p className="text-xs font-medium text-green-700 dark:text-green-400">
                          {t.cart.discountAppliesTo(
                            discountedUnits,
                            item.quantity,
                          )}
                        </p>
                      )}
                    </div>
                    <p className="whitespace-nowrap text-sm font-medium text-neutral-900 dark:text-white">
                      {formatPrice(item.quantity * item.price_cents_snapshot)}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="mt-6 space-y-2 border-t border-neutral-200 pt-4 text-sm dark:border-neutral-800">
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
                {info.shippingMethod === 'lalamove'
                  ? formatPrice(chargedShippingCents)
                  : shippingCents == null
                    ? t.checkout.enterDeliveryRegion
                    : shippingCents === 0
                      ? t.checkout.free
                      : formatPrice(shippingCents)}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-neutral-200 pt-2 text-base font-semibold dark:border-neutral-800">
              <span>{t.payment.total}</span>
              <span>{formatPrice(Math.max(0, totalCents))}</span>
            </div>
          </div>
        </aside>
      </form>
    </div>
  )
}

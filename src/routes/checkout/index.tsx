import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { useCart } from '#/lib/cart/CartContext'
import {
  isCheckoutInfoComplete,
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
  getActiveCodCountries,
  getActiveMarketMarkups,
  getActiveMarketShipping,
} from '#/server/storefront/market-pricing'
import { getLalamoveEstimate } from '#/server/checkout/lalamove'
import { placeOrder } from '#/server/checkout/place-order'
import { checkCodCityEligibility } from '#/server/checkout/cod-city-restriction'
import { getAttributedFbclid } from '#/lib/analytics/fbclid'
import {
  errorCodeOf,
  trackCheckoutEvent,
} from '#/lib/analytics/checkout-tracking'
import { ncrProvinceFallback } from '#/lib/utils/ph-region'
import { useCurrency } from '#/lib/currency/CurrencyContext'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import {
  centsToMajorUnits,
  convertCents,
  effectiveCurrency,
  formatCentsAsPHP,
} from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import { cartErrorReasonOf } from '#/lib/checkout/cart-errors'
import { CartStockWarning } from '#/components/storefront/CartStockWarning'
import { PH_MOBILE_ERROR_MESSAGE, normalizePhMobile } from '#/lib/utils/phone'
import { trackPixelEvent } from '#/lib/analytics/facebook-pixel'
import { PHAddressFields } from '#/components/storefront/PHAddressFields'
import { CountrySelect } from '#/components/storefront/CountrySelect'
import { FreeShippingNudge } from '#/components/storefront/FreeShippingNudge'
import { LalamoveAddressPicker } from '#/components/storefront/LalamoveAddressPicker'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
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

type PaymentMethod = 'cod' | 'online'

export const Route = createFileRoute('/checkout/')({
  validateSearch: z.object({
    paymentFailed: z.boolean().optional(),
  }),
  loader: async () => ({
    marketMarkups: await getActiveMarketMarkups(),
    marketShipping: await getActiveMarketShipping(),
    codCountries: await getActiveCodCountries(),
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
  const searchHint = [
    info.addressLine1,
    info.barangay,
    info.city,
    info.province,
  ]
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
        Orders placed 4PM–11:59PM are booked the next day at 10AM. Orders placed
        12AM–9:59AM are booked starting 10AM.
      </p>
    </div>
  )
}

function CheckoutPage() {
  const { marketMarkups, marketShipping, codCountries } = Route.useLoaderData()
  const { paymentFailed } = Route.useSearch()
  const { storefrontScope } = Route.useRouteContext()
  const { currency, rates, ratesLoaded, formatPrice } = useCurrency()
  const { t } = useLanguage()
  const {
    cart,
    subtotalCents: rawSubtotalCents,
    discountCents,
    isLoading,
    codAvailable,
    codUnavailableReason,
    applyDiscountCode,
    removeDiscountCode,
    refresh: refreshCart,
  } = useCart()
  const { info, setInfo, clear } = useCheckout()

  // The cart provider lives above the router and only fetches on a full page
  // load, so arriving here by client-side navigation (Back from the
  // confirmation page, a link from another page) could show a cart that
  // already became an order. Re-read it once on every visit.
  useEffect(() => {
    void refreshCart()
  }, [])
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(
    paymentFailed ? t.payment.paymentFailedError : null,
  )
  const [discountInput, setDiscountInput] = useState('')
  const [discountError, setDiscountError] = useState<string | null>(null)
  const [applyingDiscount, setApplyingDiscount] = useState(false)
  const [method, setMethod] = useState<PaymentMethod>('cod')
  const [placing, setPlacing] = useState(false)
  // The collapsed "apartment, landmark, postal code or notes" section opens
  // itself once any of those has a value (e.g. restored or prefilled info),
  // but never closes itself — only the shopper does that.
  const [optionalDetailsOpen, setOptionalDetailsOpen] = useState(false)
  const hasOptionalDetails = Boolean(
    info.addressLine2 ||
    info.landmark ||
    info.orderNotes ||
    (info.country === 'PH' && info.postalCode),
  )
  useEffect(() => {
    if (hasOptionalDetails) setOptionalDetailsOpen(true)
  }, [hasOptionalDetails])
  // Only flag the phone once the shopper has left the field — not on every
  // keystroke while they're still typing it.
  const [phoneTouched, setPhoneTouched] = useState(false)
  const phoneInvalid =
    info.country === 'PH' &&
    phoneTouched &&
    info.phone.trim() !== '' &&
    normalizePhMobile(info.phone) === null

  const isLalamove = info.shippingMethod === 'lalamove'

  // A city-level COD block isn't static any more — a customer with a
  // proven delivery track record (see cod-trust.ts) can still get COD
  // there, and that can only be known by asking the server per (email,
  // address), not by matching against a preloaded city list client-side.
  const [cityRestriction, setCityRestriction] = useState<{
    restricted: boolean
    reason: string | null
  } | null>(null)
  useEffect(() => {
    if (info.country !== 'PH' || !info.email || !info.city || !info.province) {
      setCityRestriction(null)
      return
    }
    let cancelled = false
    // Matches place-order.ts's own normalization (via withSubmittableProvince)
    // so an NCR address — which has no real province in the PSGC data —
    // still matches a restriction stored against NCR's 'Metro Manila'
    // fallback.
    checkCodCityEligibility({
      data: {
        email: info.email,
        region: info.region,
        province: ncrProvinceFallback(info.region, info.province),
        city: info.city,
      },
    })
      .then((result) => {
        if (!cancelled) setCityRestriction(result)
      })
      .catch(() => {
        if (!cancelled) setCityRestriction(null)
      })
    return () => {
      cancelled = true
    }
  }, [info.country, info.email, info.region, info.province, info.city])

  const firedInitiateCheckout = useRef(false)
  useEffect(() => {
    if (isLoading || !cart || cart.items.length === 0) return
    // Wait for exchange rates too, not just the cart — firing before rates
    // load makes effectiveCurrency() silently fall back to PHP while the
    // visitor's actual selected currency (and every displayed price) is
    // something else, reporting a mismatched (value, currency) pair to the
    // pixel. The ref below is a one-shot latch, so a premature fire here
    // can't be corrected by a later re-render.
    if (!ratesLoaded) return
    if (firedInitiateCheckout.current) return
    firedInitiateCheckout.current = true
    const target = effectiveCurrency(currency, rates)
    // Meta requires `value` to be a positive number (Events Manager flags
    // InitiateCheckout events that aren't) — a 100%-off discount code, or
    // one larger than the cart's subtotal, can bring the net amount to 0
    // or below, which a straight subtotal-minus-discount doesn't guard
    // against. Falls back to the pre-discount subtotal in that case: the
    // cart is never empty here (see the early return above), so it's
    // still a real, always-positive "how much is in this cart" signal for
    // ad optimization, which is what this event is for — unlike the
    // Purchase event's value below, this was never meant to be a financial
    // record of what got charged.
    const netMajor = centsToMajorUnits(
      convertCents(
        Math.max(0, rawSubtotalCents - discountCents),
        target,
        rates,
      ),
      target,
    )
    const value =
      netMajor > 0
        ? netMajor
        : centsToMajorUnits(
            convertCents(rawSubtotalCents, target, rates),
            target,
          )
    trackPixelEvent('InitiateCheckout', {
      content_ids: cart.items.map((item) => item.variant.product_id),
      content_type: 'product',
      num_items: cart.items.reduce((sum, item) => sum + item.quantity, 0),
      value,
      currency: target,
    })
  }, [
    isLoading,
    cart,
    rawSubtotalCents,
    discountCents,
    currency,
    rates,
    ratesLoaded,
  ])

  // checkout_view — fires once the page has a real, non-empty cart to show.
  // Also covers checkout_email_entered's "prefilled" case: a logged-in
  // customer (or a returning guest whose email was already saved on the
  // cart) can land here with info.email already valid, with no blur event
  // ever going to fire for it.
  useEffect(() => {
    if (isLoading || !cart || cart.items.length === 0) return
    trackCheckoutEvent({
      cartId: cart.id,
      eventType: 'checkout_view',
      brand: storefrontScope.brand,
      metadata: {
        item_count: cart.items.reduce((sum, item) => sum + item.quantity, 0),
        subtotal_cents: rawSubtotalCents,
      },
    })
    if (checkoutContactBaseSchema.shape.email.safeParse(info.email).success) {
      trackCheckoutEvent({
        cartId: cart.id,
        eventType: 'checkout_email_entered',
        brand: storefrontScope.brand,
        metadata: { prefilled: true },
      })
    }
    // info.email deliberately excluded — this effect's job is to catch a
    // value that was already there the moment the cart became visible, not
    // to re-fire every time the shopper types; the email input's own
    // onBlur handler covers that case instead (and the dedupe above means
    // whichever of the two fires first just wins).
  }, [isLoading, cart, rawSubtotalCents, storefrontScope.brand])

  // checkout_address_entered — every required address field present, by
  // the same country-dependent rule checkoutContactSchema itself enforces
  // (region/barangay only apply to PH).
  useEffect(() => {
    if (!cart) return
    const filled =
      info.country === 'PH'
        ? Boolean(
            info.region &&
            info.province &&
            info.city &&
            info.barangay &&
            info.addressLine1,
          )
        : Boolean(info.city && info.province && info.addressLine1)
    if (!filled) return
    trackCheckoutEvent({
      cartId: cart.id,
      eventType: 'checkout_address_entered',
      brand: storefrontScope.brand,
      metadata: {
        region: info.region,
        province: info.province,
        city: info.city,
      },
    })
  }, [
    cart,
    info.country,
    info.region,
    info.province,
    info.city,
    info.barangay,
    info.addressLine1,
    storefrontScope.brand,
  ])

  // checkout_shipping_shown — fires the first time a real shipping fee is
  // computed for this cart. Recomputes shippingCostCents independently
  // here (rather than reusing the render-time `shippingCents` further
  // below) because that's computed after this component's early
  // isLoading/empty-cart returns, and hooks can't be declared after a
  // conditional return.
  useEffect(() => {
    if (!cart) return
    if (info.country === 'PH' && !info.region) return
    const trackedSubtotalCents = applyMarketMarkup(
      rawSubtotalCents,
      marketMarkups[info.country],
    )
    const trackedDiscountCents = applyMarketMarkup(
      discountCents,
      marketMarkups[info.country],
    )
    const cents = shippingCostCents(
      info.country,
      info.region,
      info.province,
      trackedSubtotalCents - trackedDiscountCents,
      cart.items.reduce((sum, item) => sum + item.quantity, 0),
      rates,
      marketShipping[info.country],
      cart.discount?.excludesFreeShipping ?? false,
    )
    trackCheckoutEvent({
      cartId: cart.id,
      eventType: 'checkout_shipping_shown',
      brand: storefrontScope.brand,
      metadata: {
        region: info.region,
        shipping_cents: cents,
        subtotal_cents: trackedSubtotalCents,
        total_cents: Math.max(
          0,
          trackedSubtotalCents - trackedDiscountCents + cents,
        ),
        free_shipping: cents === 0,
        shipping_method: info.shippingMethod,
      },
    })
  }, [
    cart,
    info.country,
    info.region,
    info.province,
    info.shippingMethod,
    rawSubtotalCents,
    discountCents,
    rates,
    marketMarkups,
    marketShipping,
    method,
    storefrontScope.brand,
  ])

  const lalamoveRegionEligible = isLalamoveRegionEligible({
    brand: storefrontScope.brand,
    region: info.region,
  })
  const lalamoveAvailableToday = isLalamoveAvailableToday()
  // Lalamove is a same-day courier pickup — there's no real stock to hand a
  // rider until a pre-order item actually arrives, same reasoning as
  // pre-order never mixing with regular in-stock items in one order (see
  // place-order.ts's matching server-side check, which is authoritative).
  const cartHasPreOrderItems =
    cart?.items.some((item) => item.variant.is_pre_order) ?? false
  const lalamoveEligible =
    lalamoveRegionEligible && lalamoveAvailableToday && !cartHasPreOrderItems

  // If the region changes away from Metro Manila (or the window closes —
  // Sunday, or Saturday from 4PM onwards — or the cart turns out to hold a
  // pre-order item) while Lalamove is selected, fall back to standard
  // rather than letting the customer proceed with a no-longer-valid choice
  // — place-order would reject it anyway, but this catches it before they
  // even try. Placed before the early returns below (with every other hook
  // in this component) — hooks can't be called conditionally.
  useEffect(() => {
    if (info.shippingMethod === 'lalamove' && !lalamoveEligible) {
      setInfo({ ...info, shippingMethod: 'standard' })
    }
  }, [lalamoveEligible])

  // Shown next to a disabled (not hidden) COD option so the customer knows
  // why, rather than it just silently not being there.
  const codAllowedForCountry =
    info.country === 'PH' || codCountries.includes(info.country)
  const codDisabledReason = !codAllowedForCountry
    ? 'Cash on Delivery is not available — please pay online.'
    : isLalamove
      ? 'Not available for Lalamove delivery — online payment only.'
      : cityRestriction?.restricted
        ? (cityRestriction.reason ??
          'Cash on Delivery is not available in your area.')
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

  // Captured once, narrowed-non-null — TS can't carry `cart`'s non-null
  // narrowing from the early return above into the `function` declarations
  // below (handlePlaceOrder, handlePaymentMethodChange), since those could
  // in principle be called at any later point. Tracking calls inside them
  // use this instead of `cart.id` directly.
  const cartId = cart.id

  // Per-country product markup (see lib/checkout/market-pricing.ts) — keyed
  // by shipping destination, never touches the shipping fee below. Must
  // stay in sync with place-order.ts's own markup lookup, or the customer
  // would see one total here and be charged another.
  const subtotalCents = applyMarketMarkup(
    rawSubtotalCents,
    marketMarkups[info.country],
  )
  // The discount amount is computed cart-side against the raw (pre-markup)
  // subtotal — it has no notion of checkout country. Scaling it by the same
  // markup here keeps a percentage-off code meaning what it says against
  // what the customer actually sees below, instead of only discounting the
  // pre-markup amount and leaving the rest of the markup un-discounted. See
  // place-order.ts's identical fix for the amount actually charged.
  const chargedDiscountCents = applyMarketMarkup(
    discountCents,
    marketMarkups[info.country],
  )

  const shippingCents =
    info.country !== 'PH' || info.region
      ? shippingCostCents(
          info.country,
          info.region,
          info.province,
          subtotalCents - chargedDiscountCents,
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
  const totalCents = Math.max(
    0,
    subtotalCents - chargedDiscountCents + chargedShippingCents,
  )

  const discount = cart.discount
  function formatDiscountRate(type: string, value: number): string {
    return type === 'fixed_amount'
      ? `${formatPrice(value)} off`
      : `${value}% off`
  }
  const discountLabel = discount
    ? discount.type === 'free_shipping'
      ? t.cart.freeShippingLabel
      : formatDiscountRate(discount.type, discount.value)
    : null

  async function handleApplyDiscount() {
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

  function handlePaymentMethodChange(next: PaymentMethod) {
    setMethod(next)
    trackCheckoutEvent({
      cartId,
      eventType: 'checkout_payment_selected',
      brand: storefrontScope.brand,
      // Keyed by method too — switching from cod to online (or back)
      // fires again, but re-selecting the one already active doesn't.
      dedupeKey: next,
      metadata: { method: next, shipping_cents: shippingCents },
    })
  }

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

  async function handlePlaceOrder(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    trackCheckoutEvent({
      cartId,
      eventType: 'checkout_place_order_clicked',
      brand: storefrontScope.brand,
      metadata: {
        method,
        total_cents: totalCents,
        shipping_cents: shippingCents,
      },
    })
    const submittable = withSubmittableProvince(info)
    const result = checkoutContactSchema.safeParse(submittable)
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Please check your details')
      trackCheckoutEvent({
        cartId,
        eventType: 'checkout_validation_error',
        brand: storefrontScope.brand,
        allowRepeat: true,
        metadata: {
          fields: [
            ...new Set(
              result.error.issues.map((issue) =>
                String(issue.path[0] ?? 'unknown'),
              ),
            ),
          ],
        },
      })
      return
    }
    // result.data carries the normalised phone (see checkoutContactSchema's
    // transform) — keep the form showing exactly what gets stored.
    setInfo({ ...submittable, phone: result.data.phone })
    setPlacing(true)
    try {
      const placed = await placeOrder({
        data: {
          contact: submittable,
          paymentProvider: method,
          currency: method === 'cod' ? 'PHP' : currency,
          fbclid: getAttributedFbclid(),
        },
      })
      if (placed.invoiceUrl) {
        trackCheckoutEvent({
          cartId,
          eventType: 'checkout_payment_redirect',
          brand: storefrontScope.brand,
          metadata: { method, total_cents: totalCents },
        })
        // Cart/checkout state is only cleared once payment is actually
        // confirmed (the webhook), not here — the customer may bounce back
        // from Xendit without finishing.
        window.location.href = placed.invoiceUrl
        return
      }
      clear()
      // The server converted this cart into the order; drop it from the
      // client too, so going Back to this page can't resubmit it.
      void refreshCart()
      void navigate({
        to: '/checkout/confirmation',
        search: {
          // Always set here — this branch only runs for COD, which always
          // returns a real order number (see place-order.ts).
          order: placed.orderNumber ?? undefined,
          value: (totalCents / 100).toFixed(2),
          currency: 'PHP',
          // Threaded through so confirmation.tsx can fire
          // checkout_order_success with the same cart_id the rest of this
          // funnel was tracked under — by the time that page loads, this
          // cart has already been cleared (see clear() above).
          cartId,
          method,
        },
      })
    } catch (err) {
      const message = getErrorMessage(err)
      const cartReason = cartErrorReasonOf(message)
      trackCheckoutEvent({
        cartId,
        eventType: 'checkout_order_error',
        brand: storefrontScope.brand,
        allowRepeat: true,
        metadata: {
          method,
          error_code: errorCodeOf(err),
          message: message.slice(0, 300),
          reason: cartReason ?? 'other',
        },
      })
      setError(message)
      // The page was showing a cart the server no longer has — re-read it so
      // the summary matches reality instead of inviting another retry.
      if (cartReason) void refreshCart()
    } finally {
      setPlacing(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-2xl font-bold tracking-tight">{t.checkout.title}</h1>

      <CartStockWarning issues={cart.stockIssues} className="mt-4" />

      {/* Reassurance before the form, where shoppers decide whether to
          start filling it in. COD only claimed when it's actually offered
          for this cart/destination. */}
      <p className="mt-3 text-xs font-medium text-neutral-600 sm:text-sm dark:text-neutral-400">
        {[
          !codDisabledReason && 'Cash on delivery available',
          'Easy exchange',
          'Ships in 1–2 days',
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      <form
        onSubmit={(event) => void handlePlaceOrder(event)}
        className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_380px]"
      >
        <div className="space-y-8">
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">{t.checkout.contact}</h2>
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
                  trackCheckoutEvent({
                    cartId: cart.id,
                    eventType: 'checkout_email_entered',
                    brand: storefrontScope.brand,
                    metadata: { prefilled: false },
                  })
                  void saveCartEmail({ data: { email: result.data } }).catch(
                    () => {},
                  )
                }}
                className={inputClassName}
              />
            </label>
            <label className={labelClassName}>
              {t.checkout.phone}
              <input
                required
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={
                  info.country === 'PH' ? '0917 123 4567' : undefined
                }
                value={info.phone}
                onChange={(e) => setInfo({ ...info, phone: e.target.value })}
                onBlur={() => {
                  setPhoneTouched(true)
                  // Tidy a valid number into the stored format as soon
                  // as they leave the field, so what they see is what
                  // gets saved.
                  if (info.country !== 'PH') return
                  const normalized = normalizePhMobile(info.phone)
                  if (normalized && normalized !== info.phone) {
                    setInfo({ ...info, phone: normalized })
                  }
                }}
                aria-invalid={phoneInvalid || undefined}
                aria-describedby="checkout-phone-hint"
                className={inputClassName}
              />
              {info.country === 'PH' && (
                <span
                  id="checkout-phone-hint"
                  className={`mt-1 block text-xs font-normal ${
                    phoneInvalid
                      ? 'text-red-700 dark:text-red-400'
                      : 'text-neutral-500 dark:text-neutral-400'
                  }`}
                >
                  {phoneInvalid
                    ? PH_MOBILE_ERROR_MESSAGE
                    : 'e.g. 0917 123 4567'}
                </span>
              )}
            </label>
          </section>

          <section>
            <h2 className="mb-4 text-lg font-semibold">
              {t.checkout.delivery}
            </h2>
            <div className="space-y-4">
              <div className={labelClassName}>
                {t.checkout.country}
                <CountrySelect
                  value={info.country}
                  onChange={handleCountryChange}
                  countryCodes={['PH', ...Object.keys(marketMarkups)]}
                />
                {marketMarkups[info.country] && (
                  <p className="mt-1 text-xs font-normal text-neutral-500 dark:text-neutral-400">
                    {t.checkout.internationalMarkupNotice}
                  </p>
                )}
              </div>

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

              <label className={labelClassName}>
                {t.checkout.addressLine1}
                <input
                  required
                  autoComplete="address-line1"
                  placeholder={t.checkout.addressLine1Placeholder}
                  value={info.addressLine1}
                  onChange={(e) =>
                    setInfo({ ...info, addressLine1: e.target.value })
                  }
                  className={inputClassName}
                />
              </label>

              {info.country !== 'PH' && (
                <label className={labelClassName}>
                  {t.checkout.postalCode}
                  <input
                    required
                    autoComplete="postal-code"
                    value={info.postalCode}
                    onChange={(e) =>
                      setInfo({ ...info, postalCode: e.target.value })
                    }
                    className={inputClassName}
                  />
                </label>
              )}

              {/* Everything optional lives behind one tap, so the required
                  path stays short. Opens on its own if anything in it is
                  already filled in (e.g. a returning shopper). */}
              <details
                open={optionalDetailsOpen}
                onToggle={(e) => setOptionalDetailsOpen(e.currentTarget.open)}
                className="group rounded-md border border-neutral-200 dark:border-neutral-800"
              >
                <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-neutral-700 select-none dark:text-neutral-300">
                  <span className="mr-1 inline-block transition group-open:rotate-90">
                    ›
                  </span>
                  Add apartment, landmark, postal code or delivery notes
                  (optional)
                </summary>
                <div className="space-y-4 px-4 pb-4">
                  <label className={labelClassName}>
                    {t.checkout.addressLine2Optional}
                    <input
                      autoComplete="address-line2"
                      value={info.addressLine2}
                      onChange={(e) =>
                        setInfo({ ...info, addressLine2: e.target.value })
                      }
                      className={inputClassName}
                    />
                  </label>
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
                  {info.country === 'PH' && (
                    <label className={labelClassName}>
                      {t.account.postalCodeOptional}
                      <input
                        inputMode="numeric"
                        autoComplete="postal-code"
                        value={info.postalCode}
                        onChange={(e) =>
                          setInfo({ ...info, postalCode: e.target.value })
                        }
                        className={inputClassName}
                      />
                    </label>
                  )}
                  <label className={labelClassName}>
                    Delivery notes (optional)
                    <textarea
                      rows={3}
                      maxLength={500}
                      value={info.orderNotes}
                      onChange={(e) =>
                        setInfo({ ...info, orderNotes: e.target.value })
                      }
                      placeholder="Delivery instructions, gift note, etc."
                      className={inputClassName}
                    />
                  </label>
                </div>
              </details>
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
                    !lalamoveAvailableToday || cartHasPreOrderItems
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
                      disabled={!lalamoveAvailableToday || cartHasPreOrderItems}
                      checked={info.shippingMethod === 'lalamove'}
                      onChange={() =>
                        setInfo({ ...info, shippingMethod: 'lalamove' })
                      }
                    />
                    <span className="font-medium text-neutral-900 dark:text-white">
                      Lalamove Same-day Delivery (10AM–4PM, Metro Manila only)
                      {cartHasPreOrderItems ? (
                        <span className="block text-xs font-normal text-neutral-500 dark:text-neutral-400">
                          Not available for pre-order items.
                        </span>
                      ) : (
                        !lalamoveAvailableToday && (
                          <span className="block text-xs font-normal text-neutral-500 dark:text-neutral-400">
                            Not available Saturday from 4PM onwards, or on
                            Sundays.
                          </span>
                        )
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
                  {shippingCents === 0
                    ? t.checkout.free
                    : formatPrice(shippingCents)}
                </span>
              </div>
            )}
            {info.shippingMethod !== 'lalamove' && (
              <FreeShippingNudge
                progress={freeShippingProgress(
                  info.country,
                  subtotalCents - chargedDiscountCents,
                  cart.items.reduce((sum, item) => sum + item.quantity, 0),
                  marketShipping[info.country],
                  cart.discount?.excludesFreeShipping ?? false,
                )}
                className="mt-3 text-center text-xs font-medium text-neutral-600 dark:text-neutral-400"
              />
            )}
          </section>

          <section>
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
                  onChange={() => handlePaymentMethodChange('cod')}
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
                  onChange={() => handlePaymentMethodChange('online')}
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

          {error && (
            <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            // place-order rejects a cart with a sold-out line anyway — keep
            // the button off until the warning at the top is resolved.
            disabled={placing || cart.stockIssues.length > 0}
            className={`${buttonPrimaryClassName} w-full justify-center`}
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
              const itemDiscount = cart.discount?.itemBreakdown.find(
                (b) => b.cartItemId === item.id,
              )
              const discountedUnits = itemDiscount?.discountedUnits ?? 0
              const lineTotalCents = item.quantity * item.price_cents_snapshot
              // Uses this item's own discountedAmountCents (not a blanket
              // percentage) since a stacked discount may not cover every
              // item the same way — see
              // AppliedCartDiscount.itemBreakdown's doc comment.
              const discountedLineCents = itemDiscount
                ? lineTotalCents - itemDiscount.discountedAmountCents
                : null
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
                    {discountedLineCents != null ? (
                      <div className="whitespace-nowrap text-right">
                        <p className="text-xs text-neutral-400 line-through dark:text-neutral-600">
                          {formatPrice(lineTotalCents)}
                        </p>
                        <p className="text-sm font-medium text-green-700 dark:text-green-400">
                          {formatPrice(discountedLineCents)}
                        </p>
                      </div>
                    ) : (
                      <p className="whitespace-nowrap text-sm font-medium text-neutral-900 dark:text-white">
                        {formatPrice(lineTotalCents)}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          {/* Same code-apply UI as the cart page — a customer who skipped
              applying a code there (or came here straight from a product
              page) can still enter one before paying. Only a real
              customer-entered code gets the "applied [Remove]" banner; an
              automatic store-wide/collection sale just shows up in the
              price breakdown below with nothing to remove. */}
          <div className="mt-6 border-t border-neutral-200 pt-4 dark:border-neutral-800">
            {discount?.code ? (
              <div className="mb-4 flex items-center justify-between rounded-md bg-green-50 px-4 py-3 dark:bg-green-950/30">
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
              // A plain div, not a <form> — this whole page is already one
              // <form onSubmit={handlePlaceOrder}> (see above), and a <form>
              // can't nest inside another: the browser silently drops the
              // inner tag, so its submit button ends up submitting the
              // OUTER checkout form instead of applying the code.
              <div className="mb-4 flex gap-2">
                <input
                  value={discountInput}
                  onChange={(e) => setDiscountInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    void handleApplyDiscount()
                  }}
                  placeholder={t.cart.discountCodePlaceholder}
                  className={`${inputClassName} flex-1`}
                />
                <button
                  type="button"
                  onClick={() => void handleApplyDiscount()}
                  disabled={applyingDiscount}
                  className={buttonSecondaryClassName}
                >
                  {applyingDiscount ? t.cart.applying : t.cart.apply}
                </button>
              </div>
            )}
            {discountError && (
              <p className="mb-4 text-sm text-red-700 dark:text-red-400">
                {discountError}
              </p>
            )}
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-neutral-600 dark:text-neutral-400">
                {t.payment.subtotal}
              </span>
              <span className="font-medium">{formatPrice(subtotalCents)}</span>
            </div>
            {chargedDiscountCents > 0 && (
              <div className="flex items-center justify-between text-green-700 dark:text-green-400">
                <span>{t.payment.discount}</span>
                <span>-{formatPrice(chargedDiscountCents)}</span>
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
              <span>{formatPrice(totalCents)}</span>
            </div>
          </div>

          {!isCheckoutInfoComplete(info) && (
            <p className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
              {t.payment.missingDeliveryBody}
            </p>
          )}
        </aside>
      </form>
    </div>
  )
}

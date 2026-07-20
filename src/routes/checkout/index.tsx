import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useCart } from '#/lib/cart/CartContext'
import {
  useCheckout,
  withSubmittableProvince,
} from '#/lib/checkout/CheckoutContext'
import { checkoutContactSchema } from '#/lib/validation/checkout'
import { shippingCostCents } from '#/lib/checkout/shipping'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { trackPixelEvent } from '#/lib/analytics/facebook-pixel'
import { PHAddressFields } from '#/components/storefront/PHAddressFields'
import {
  buttonPrimaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/storefront/ui'

export const Route = createFileRoute('/checkout/')({ component: CheckoutPage })

function CheckoutPage() {
  const { cart, subtotalCents, discountCents, isLoading } = useCart()
  const { info, setInfo } = useCheckout()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  const firedInitiateCheckout = useRef(false)
  useEffect(() => {
    if (isLoading || !cart || cart.items.length === 0) return
    if (firedInitiateCheckout.current) return
    firedInitiateCheckout.current = true
    trackPixelEvent('InitiateCheckout', {
      content_ids: cart.items.map((item) => item.variant.product_id),
      content_type: 'product',
      num_items: cart.items.reduce((sum, item) => sum + item.quantity, 0),
      value: (subtotalCents - discountCents) / 100,
      currency: 'PHP',
    })
  }, [isLoading, cart, subtotalCents, discountCents])

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-16 text-neutral-500 dark:text-neutral-400">
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

  const shippingCents = info.region
    ? shippingCostCents(info.region, subtotalCents - discountCents)
    : null
  const totalCents = subtotalCents - discountCents + (shippingCents ?? 0)

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
      <h1 className="text-2xl font-bold tracking-tight">Checkout</h1>

      <form
        onSubmit={handleSubmit}
        className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_380px]"
      >
        <div className="space-y-8">
          <section>
            <h2 className="mb-4 text-lg font-semibold">Contact</h2>
            <label className={labelClassName}>
              Email
              <input
                type="email"
                required
                value={info.email}
                onChange={(e) => setInfo({ ...info, email: e.target.value })}
                className={inputClassName}
              />
            </label>
          </section>

          <section>
            <h2 className="mb-4 text-lg font-semibold">Delivery</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className={labelClassName}>
                  Recipient name
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
                  Phone
                  <input
                    required
                    placeholder="09171234567"
                    value={info.phone}
                    onChange={(e) =>
                      setInfo({ ...info, phone: e.target.value })
                    }
                    className={inputClassName}
                  />
                </label>
              </div>

              <PHAddressFields
                value={{
                  region: info.region,
                  province: info.province,
                  city: info.city,
                  barangay: info.barangay,
                }}
                onChange={(addr) => setInfo({ ...info, ...addr })}
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className={labelClassName}>
                  Address line 1
                  <input
                    required
                    placeholder="House/unit no., street"
                    value={info.addressLine1}
                    onChange={(e) =>
                      setInfo({ ...info, addressLine1: e.target.value })
                    }
                    className={inputClassName}
                  />
                </label>
                <label className={labelClassName}>
                  Address line 2 (optional)
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
                  Landmark (optional)
                  <input
                    value={info.landmark}
                    onChange={(e) =>
                      setInfo({ ...info, landmark: e.target.value })
                    }
                    className={inputClassName}
                  />
                </label>
                <label className={labelClassName}>
                  Postal code (optional)
                  <input
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
            <h2 className="mb-4 text-lg font-semibold">Shipping method</h2>
            {shippingCents == null ? (
              <p className="rounded-md bg-neutral-50 px-4 py-3 text-sm text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                Select a region above to see shipping options.
              </p>
            ) : (
              <div className="flex items-center justify-between rounded-md border border-neutral-900 bg-neutral-50 px-4 py-3 text-sm dark:border-white dark:bg-neutral-900">
                <span className="font-medium text-neutral-900 dark:text-white">
                  Standard shipping
                </span>
                <span className="font-medium text-neutral-900 dark:text-white">
                  {shippingCents === 0
                    ? 'Free'
                    : formatCentsAsPHP(shippingCents)}
                </span>
              </div>
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
            Continue to payment
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
                    </div>
                    <p className="whitespace-nowrap text-sm font-medium text-neutral-900 dark:text-white">
                      {formatCentsAsPHP(
                        item.quantity * item.price_cents_snapshot,
                      )}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="mt-6 space-y-2 border-t border-neutral-200 pt-4 text-sm dark:border-neutral-800">
            <div className="flex items-center justify-between">
              <span className="text-neutral-600 dark:text-neutral-400">
                Subtotal
              </span>
              <span className="font-medium">
                {formatCentsAsPHP(subtotalCents)}
              </span>
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
                {shippingCents == null
                  ? 'Enter delivery region'
                  : shippingCents === 0
                    ? 'Free'
                    : formatCentsAsPHP(shippingCents)}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-neutral-200 pt-2 text-base font-semibold dark:border-neutral-800">
              <span>Total</span>
              <span>{formatCentsAsPHP(Math.max(0, totalCents))}</span>
            </div>
          </div>
        </aside>
      </form>
    </div>
  )
}

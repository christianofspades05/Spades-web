import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useCart } from '#/lib/cart/CartContext'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
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
    cart,
    subtotalCents,
    discountCents,
    totalCents,
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

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-neutral-500 dark:text-neutral-400">
        Loading cart...
      </div>
    )
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
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
  const discountLabel = discount
    ? discount.type === 'percentage'
      ? `${discount.value}% off`
      : discount.type === 'fixed_amount'
        ? `${formatCentsAsPHP(discount.value)} off`
        : 'Free shipping'
    : null

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-bold tracking-tight">Your Cart</h1>

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
                    Remove
                  </button>
                </div>
              </div>

              <p className="whitespace-nowrap font-medium text-neutral-900 dark:text-white">
                {formatCentsAsPHP(item.quantity * item.price_cents_snapshot)}
              </p>
            </li>
          )
        })}
      </ul>

      <div className="mt-8 border-t border-neutral-200 pt-6 dark:border-neutral-800">
        {discount ? (
          <div className="mb-5 flex items-center justify-between rounded-md bg-green-50 px-4 py-3 dark:bg-green-950/30">
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                {discount.code ?? discount.title} applied
              </p>
              <p className="text-xs text-green-700 dark:text-green-400">
                {discountLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={handleRemoveDiscount}
              className="text-sm text-green-700 underline hover:text-green-900 dark:text-green-400 dark:hover:text-green-200"
            >
              Remove
            </button>
          </div>
        ) : (
          <form onSubmit={handleApplyDiscount} className="mb-5 flex gap-2">
            <input
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value)}
              placeholder="Discount code"
              className={`${inputClassName} flex-1`}
            />
            <button
              type="submit"
              disabled={applyingDiscount}
              className={buttonSecondaryClassName}
            >
              {applyingDiscount ? 'Applying...' : 'Apply'}
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
            Subtotal
          </span>
          <span className="font-medium text-neutral-900 dark:text-white">
            {formatCentsAsPHP(subtotalCents)}
          </span>
        </div>
        {discountCents > 0 && (
          <div className="mt-2 flex items-center justify-between text-green-700 dark:text-green-400">
            <span>Discount</span>
            <span>-{formatCentsAsPHP(discountCents)}</span>
          </div>
        )}
        <div className="mt-3 flex items-center justify-between border-t border-neutral-200 pt-3 text-lg font-semibold dark:border-neutral-800">
          <span>Total</span>
          <span>{formatCentsAsPHP(totalCents)}</span>
        </div>
      </div>

      <Link
        to="/checkout"
        className={`${buttonPrimaryClassName} mt-6 w-full justify-center`}
      >
        Checkout
      </Link>
    </div>
  )
}

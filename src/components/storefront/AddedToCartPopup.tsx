import { Link } from '@tanstack/react-router'
import { Check, X } from 'lucide-react'
import { FreeShippingNudge } from '#/components/storefront/FreeShippingNudge'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import type { FreeShippingProgress } from '#/lib/checkout/shipping'

export interface AddedToCartItem {
  image: string | null
  productName: string
  variantLabel: string
}

export function AddedToCartPopup({
  item,
  itemCount,
  freeShippingProgress,
  onClose,
}: {
  item: AddedToCartItem
  itemCount: number
  freeShippingProgress: FreeShippingProgress | null
  onClose: () => void
}) {
  const { t } = useLanguage()
  return (
    <div className="fixed inset-x-4 top-20 z-50 mx-auto max-w-sm rounded-lg bg-neutral-950 p-5 text-white shadow-xl sm:inset-x-auto sm:right-6 sm:left-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Check className="h-4 w-4" />
          {t.addedToCart.itemAdded}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-neutral-400 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 flex items-center gap-3">
        {item.image ? (
          <img
            src={item.image}
            alt=""
            className="size-14 shrink-0 rounded-md object-cover"
          />
        ) : (
          <div className="size-14 shrink-0 rounded-md bg-neutral-800" />
        )}
        <div>
          <p className="text-sm font-semibold">{item.productName}</p>
          {item.variantLabel && (
            <p className="text-xs text-neutral-400">{item.variantLabel}</p>
          )}
        </div>
      </div>

      <FreeShippingNudge
        progress={freeShippingProgress}
        className="mt-4 text-center text-xs font-medium text-neutral-300"
      />

      <div className="mt-3 flex flex-col gap-2">
        <Link
          to="/cart"
          className="rounded-full border border-white px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-white hover:text-neutral-950"
        >
          {t.addedToCart.viewMyCart(itemCount)}
        </Link>
        <Link
          to="/checkout"
          className="rounded-full bg-white px-4 py-2.5 text-center text-sm font-semibold text-neutral-950 transition hover:bg-neutral-200"
        >
          {t.addedToCart.checkOut}
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="text-center text-sm text-neutral-300 underline hover:text-white"
        >
          {t.addedToCart.continueShopping}
        </button>
      </div>
    </div>
  )
}

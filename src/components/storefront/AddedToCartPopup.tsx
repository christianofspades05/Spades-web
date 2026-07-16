import { Link } from '@tanstack/react-router'
import { Check, X } from 'lucide-react'

export interface AddedToCartItem {
  image: string | null
  productName: string
  variantLabel: string
}

export function AddedToCartPopup({
  item,
  itemCount,
  onClose,
}: {
  item: AddedToCartItem
  itemCount: number
  onClose: () => void
}) {
  return (
    <div className="fixed inset-x-4 top-20 z-50 mx-auto max-w-sm rounded-lg bg-neutral-950 p-5 text-white shadow-xl sm:inset-x-auto sm:right-6 sm:left-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Check className="h-4 w-4" />
          Item added to your cart
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

      <div className="mt-5 flex flex-col gap-2">
        <Link
          to="/cart"
          className="rounded-full border border-white px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-white hover:text-neutral-950"
        >
          View my cart ({itemCount})
        </Link>
        <Link
          to="/checkout"
          className="rounded-full bg-white px-4 py-2.5 text-center text-sm font-semibold text-neutral-950 transition hover:bg-neutral-200"
        >
          Check out
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="text-center text-sm text-neutral-300 underline hover:text-white"
        >
          Continue shopping
        </button>
      </div>
    </div>
  )
}

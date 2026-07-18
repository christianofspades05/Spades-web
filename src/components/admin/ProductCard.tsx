import { Package } from 'lucide-react'
import { StatusBadge } from '#/components/admin/Badge'
import type { ProductStatus } from '#/types/entities'

export interface ProductCardData {
  id: string
  name: string
  images: string[]
  status: ProductStatus
  product_type: string
}

/** Mobile row rendering of a product-list item — a compact list row (checkbox, photo, title/status, stock, collections), matching the same flat, dense list style as InventoryCard.tsx rather than a padded card. Kept out of products/index.tsx to avoid adding to that file's already-heavy route-type-checking surface (see OrderCard.tsx for the same reasoning). */
export function ProductCard({
  product,
  onHand,
  isLowStock,
  categories,
  variantCount,
  checked,
  onToggle,
  onOpen,
}: {
  product: ProductCardData
  onHand: number
  isLowStock: boolean
  categories: string
  variantCount: number
  checked: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  return (
    <div
      onClick={onOpen}
      className="flex cursor-pointer items-center gap-3 border-b border-neutral-100 py-3 first:pt-0 last:border-b-0"
    >
      <div onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={onToggle} />
      </div>
      {product.images[0] ? (
        <img
          src={product.images[0]}
          alt=""
          className="size-11 shrink-0 rounded-md border border-neutral-200 object-cover"
        />
      ) : (
        <div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50">
          <Package size={16} className="text-neutral-300" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-neutral-900">{product.name}</p>
        <div className="mt-0.5 flex items-center gap-1.5">
          <StatusBadge status={product.status} kind="product" />
          <span
            className={`text-xs ${isLowStock ? 'font-medium text-red-600' : 'text-neutral-500'}`}
          >
            {onHand} in stock for {variantCount}{' '}
            {variantCount === 1 ? 'variant' : 'variants'}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-neutral-400">
          {categories || 'No collections'}
        </p>
      </div>
    </div>
  )
}

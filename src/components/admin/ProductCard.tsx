import { Package } from 'lucide-react'
import { Card } from '#/components/admin/Card'
import { StatusBadge } from '#/components/admin/Badge'
import type { ProductStatus } from '#/types/entities'

export interface ProductCardData {
  id: string
  name: string
  images: string[]
  status: ProductStatus
  product_type: string
}

/** Mobile card rendering of a product-list row — kept out of products/index.tsx to avoid adding to that file's already-heavy route-type-checking surface (see OrderCard.tsx for the same reasoning). */
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
    <Card onClick={onOpen} className="cursor-pointer p-4">
      <div className="flex items-start gap-3">
        <div onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={checked} onChange={onToggle} />
        </div>
        {product.images[0] ? (
          <img
            src={product.images[0]}
            alt=""
            className="size-10 shrink-0 rounded-md border border-neutral-200 object-cover"
          />
        ) : (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50">
            <Package size={16} className="text-neutral-300" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-neutral-900">
            {product.name}
          </p>
          <div className="mt-1">
            <StatusBadge status={product.status} kind="product" />
          </div>
        </div>
      </div>

      <div className="mt-2.5 text-sm">
        <span className={isLowStock ? 'font-medium text-red-600' : ''}>
          {onHand} in stock
        </span>
        <span className="text-neutral-500">
          {' '}
          for {variantCount} {variantCount === 1 ? 'variant' : 'variants'}
        </span>
      </div>

      <div className="mt-1.5 flex items-center justify-between text-xs text-neutral-500">
        <span>{categories || 'No collections'}</span>
        <span className="capitalize">{product.product_type}</span>
      </div>
    </Card>
  )
}

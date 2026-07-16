import { Link } from '@tanstack/react-router'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { badgeOutOfStockClassName } from './ui'
import type { StorefrontListingProduct } from '#/server/products/queries'

interface ProductCardProps {
  product: StorefrontListingProduct
}

export function ProductCard({ product }: ProductCardProps) {
  const imageUrl = product.images[0]
  const outOfStock = product.total_stock <= 0

  return (
    <Link
      to="/products/$slug"
      params={{ slug: product.slug }}
      className="group block"
    >
      <div className="relative aspect-square overflow-hidden rounded-xl bg-neutral-100 dark:bg-neutral-900">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-contain transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-neutral-400 dark:text-neutral-600">
            No image
          </div>
        )}
        {outOfStock && (
          <span className={`absolute left-3 top-3 ${badgeOutOfStockClassName}`}>
            Out of stock
          </span>
        )}
      </div>
      <div className="mt-3 space-y-0.5">
        <p className="text-sm font-medium text-neutral-900 dark:text-white">
          {product.name}
        </p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {formatCentsAsPHP(product.min_price_cents)}
        </p>
      </div>
    </Link>
  )
}

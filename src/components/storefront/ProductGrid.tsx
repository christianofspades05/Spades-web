import { ProductCard } from './ProductCard'
import type {
  StorefrontListingProduct,
  WithSalePrice,
} from '#/server/products/queries'

interface ProductGridProps {
  products: (StorefrontListingProduct & Partial<WithSalePrice>)[]
  emptyMessage?: string
  columns?: 4 | 5
}

const LG_COLUMNS_CLASS_NAME: Record<4 | 5, string> = {
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
}

export function ProductGrid({
  products,
  emptyMessage = 'No products found.',
  columns = 4,
}: ProductGridProps) {
  if (products.length === 0) {
    return (
      <p className="py-16 text-center text-neutral-500 dark:text-neutral-400">
        {emptyMessage}
      </p>
    )
  }

  return (
    <ul
      className={`grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 sm:gap-x-8 ${LG_COLUMNS_CLASS_NAME[columns]}`}
    >
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} />
        </li>
      ))}
    </ul>
  )
}

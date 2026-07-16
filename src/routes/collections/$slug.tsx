import { createFileRoute, Link } from '@tanstack/react-router'
import { listActiveProducts } from '#/server/products/queries'
import { toListingProduct } from '#/lib/utils/product-shape'
import { collectionTitleForSlug } from '#/lib/collections/display'
import { ProductGrid } from '#/components/storefront/ProductGrid'

const PRODUCTS_PER_ROW = 5
/** listActiveProducts caps limit at 100 (see listActiveProductsSchema). */
const FETCH_LIMIT = 100

export const Route = createFileRoute('/collections/$slug')({
  loader: async ({ params }) => {
    const products = await listActiveProducts({
      data: { collectionSlug: params.slug, limit: FETCH_LIMIT },
    })
    return {
      title: collectionTitleForSlug(params.slug),
      products: products.map(toListingProduct),
    }
  },
  component: CollectionDetailPage,
})

function CollectionDetailPage() {
  const { title, products } = Route.useLoaderData()

  return (
    <div className="mx-auto max-w-6xl px-6 py-14 sm:py-20">
      <div className="mb-10 flex items-center justify-between">
        <h1 className="text-3xl font-black uppercase tracking-tight">
          {title}
        </h1>
        <Link
          to="/collections"
          className="text-sm text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"
        >
          All Collections
        </Link>
      </div>
      <ProductGrid
        products={products}
        emptyMessage="No products in this collection yet."
        columns={PRODUCTS_PER_ROW}
      />
    </div>
  )
}

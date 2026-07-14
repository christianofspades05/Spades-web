import { createFileRoute, Link } from '@tanstack/react-router'
import { listActiveProducts } from '#/server/products/queries'
import { formatCentsAsPHP } from '#/lib/utils/money'

export const Route = createFileRoute('/products/')({
  loader: () => listActiveProducts({ data: {} }),
  component: ProductsPage,
})

function ProductsPage() {
  const products = Route.useLoaderData()

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <h1 className="mb-8 text-3xl font-bold">All Products</h1>
      {products.length === 0 ? (
        <p className="text-neutral-500">No products yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4">
          {products.map((product) => {
            const lowestPriceCents = product.variants.reduce<number | null>(
              (min, variant) => (min === null || variant.price_cents < min ? variant.price_cents : min),
              null,
            )
            return (
              <li key={product.id}>
                <Link
                  to="/products/$slug"
                  params={{ slug: product.slug }}
                  className="block rounded-lg border border-neutral-200 p-4 hover:border-neutral-400"
                >
                  <p className="font-medium">{product.name}</p>
                  {lowestPriceCents !== null && (
                    <p className="mt-1 text-sm text-neutral-500">
                      {formatCentsAsPHP(lowestPriceCents)}
                    </p>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

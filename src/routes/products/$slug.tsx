import { createFileRoute, notFound } from '@tanstack/react-router'
import { getProductBySlug } from '#/server/products/queries'
import { formatCentsAsPHP } from '#/lib/utils/money'

export const Route = createFileRoute('/products/$slug')({
  loader: async ({ params }) => {
    const product = await getProductBySlug({ data: { slug: params.slug } })
    if (!product) throw notFound()
    return product
  },
  component: ProductPage,
})

function ProductPage() {
  const product = Route.useLoaderData()

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-3xl font-bold">{product.name}</h1>
      {product.description && <p className="mt-4 text-neutral-600">{product.description}</p>}

      <div className="mt-8 space-y-2">
        {product.variants.map((variant) => (
          <div
            key={variant.id}
            className="flex items-center justify-between rounded-lg border border-neutral-200 p-4"
          >
            <span>
              {[variant.size, variant.color, variant.style].filter(Boolean).join(' / ') || variant.sku}
            </span>
            <span className="font-medium">{formatCentsAsPHP(variant.price_cents)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

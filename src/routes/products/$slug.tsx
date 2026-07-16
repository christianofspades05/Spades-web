import { useState } from 'react'
import {
  createFileRoute,
  notFound,
  useRouterState,
} from '@tanstack/react-router'
import {
  getProductBySlug,
  listRelatedProducts,
} from '#/server/products/queries'
import { getProductReviews } from '#/server/reviews/queries'
import { recordVisit } from '#/server/analytics/track'
import { getOrCreateVisitorId } from '#/lib/analytics/visitor-id'
import { useCart } from '#/lib/cart/CartContext'
import { getErrorMessage } from '#/lib/utils/errors'
import { ImageGallery } from '#/components/storefront/ImageGallery'
import { VariantSelector } from '#/components/storefront/VariantSelector'
import type { VariantWithStock } from '#/components/storefront/VariantSelector'
import { ProductGrid } from '#/components/storefront/ProductGrid'
import { PaymentBadges } from '#/components/storefront/PaymentBadges'
import {
  ProductRatingSummary,
  ProductReviewsList,
} from '#/components/storefront/ProductReviews'
import { buttonPrimaryClassName } from '#/components/storefront/ui'

export const Route = createFileRoute('/products/$slug')({
  loader: async ({ params }) => {
    const product = await getProductBySlug({ data: { slug: params.slug } })
    if (!product) throw notFound()

    const [related, reviews] = await Promise.all([
      listRelatedProducts({
        data: {
          productType: product.product_type,
          excludeProductId: product.id,
          limit: 4,
        },
      }),
      getProductReviews({ data: { productId: product.id } }),
    ])

    return { product, related, reviews }
  },
  component: ProductPage,
})

function ProductPage() {
  const { product, related, reviews } = Route.useLoaderData()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { addItem } = useCart()

  const [selectedVariant, setSelectedVariant] = useState<
    VariantWithStock | undefined
  >()
  const [quantity, setQuantity] = useState(1)
  const [isAdding, setIsAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState(false)

  const availableStock =
    selectedVariant?.inventory.reduce(
      (sum, inv) => sum + inv.quantity_available,
      0,
    ) ?? 0
  const outOfStock = Boolean(selectedVariant) && availableStock <= 0

  async function handleAddToCart() {
    if (!selectedVariant || outOfStock) return
    setError(null)
    setAdded(false)
    setIsAdding(true)
    try {
      await addItem(selectedVariant.id, quantity)
      setAdded(true)
      void recordVisit({
        data: {
          visitorId: getOrCreateVisitorId(),
          path: pathname,
          eventType: 'checkout_start',
          productId: product.id,
          metadata: { variantId: selectedVariant.id, quantity },
        },
      })
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="grid grid-cols-1 gap-10 md:grid-cols-4">
        {/* Title + rating */}
        <div className="md:col-span-1">
          <h1 className="text-3xl font-bold tracking-tight">{product.name}</h1>
          <ProductRatingSummary
            averageRating={reviews.averageRating}
            reviewCount={reviews.reviewCount}
          />
        </div>

        {/* Mockup */}
        <div className="md:col-span-2 md:mt-12">
          <ImageGallery images={product.images} alt={product.name} />
        </div>

        {/* Buying selection */}
        <div className="md:col-span-1">
          <VariantSelector
            variants={product.variants as VariantWithStock[]}
            onVariantChange={setSelectedVariant}
          />

          <div className="mt-6 flex items-center gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="h-9 w-9 rounded-full border border-neutral-300 hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-white"
              >
                −
              </button>
              <span className="w-8 text-center">{quantity}</span>
              <button
                type="button"
                onClick={() =>
                  setQuantity((q) => Math.min(20, availableStock || 20, q + 1))
                }
                className="h-9 w-9 rounded-full border border-neutral-300 hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-white"
              >
                +
              </button>
            </div>

            <button
              type="button"
              disabled={!selectedVariant || outOfStock || isAdding}
              onClick={handleAddToCart}
              className={`${buttonPrimaryClassName} flex-1 justify-center`}
            >
              {outOfStock
                ? 'Out of stock'
                : !selectedVariant
                  ? 'Select options'
                  : isAdding
                    ? 'Adding...'
                    : 'Add to Cart'}
            </button>
          </div>

          {added && (
            <p className="mt-3 text-sm text-green-700 dark:text-green-400">
              Added to cart.
            </p>
          )}
          {error && (
            <p className="mt-3 text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          )}

          <PaymentBadges />
        </div>

        {/* Description — placed after the buy box/payment badges in the mobile
            stacking order (this is the 4th DOM child), but pinned back into
            column 1 on desktop via an explicit column-start so the md:4-col
            layout looks exactly as it did before. */}
        {product.description && (
          <div
            dir="rtl"
            className="md:col-start-1 md:max-h-[70vh] md:overflow-y-auto md:pl-3"
          >
            <p
              dir="ltr"
              className="whitespace-pre-line text-neutral-600 dark:text-neutral-400"
            >
              {product.description}
            </p>
          </div>
        )}

        {/* Reviews — same reasoning as Description above, pinned back under the buy box (column 4). */}
        <div className="md:col-start-4">
          <ProductReviewsList reviews={reviews.reviews} />
        </div>
      </div>

      {related.length > 0 && (
        <div className="mt-20">
          <h2 className="mb-6 text-xl font-bold">You may also like</h2>
          <ProductGrid products={related} />
        </div>
      )}
    </div>
  )
}

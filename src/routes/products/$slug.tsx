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
import { formatSizeLabel } from '#/lib/utils/size-order'
import { ImageGallery } from '#/components/storefront/ImageGallery'
import { VariantSelector } from '#/components/storefront/VariantSelector'
import type { VariantWithStock } from '#/components/storefront/VariantSelector'
import { ProductGrid } from '#/components/storefront/ProductGrid'
import { PaymentBadges } from '#/components/storefront/PaymentBadges'
import {
  ProductRatingSummary,
  ProductReviewsList,
} from '#/components/storefront/ProductReviews'
import { AddedToCartPopup } from '#/components/storefront/AddedToCartPopup'
import type { AddedToCartItem } from '#/components/storefront/AddedToCartPopup'
import { buttonPrimaryClassName } from '#/components/storefront/ui'
import { STOREFRONT_CACHE_HEADERS } from '#/lib/utils/cache-control'

function formatVariantLabel(variant: VariantWithStock): string {
  const parts: string[] = []
  if (variant.size) parts.push(`Size: ${formatSizeLabel(variant.size)}`)
  if (variant.color) parts.push(`Color: ${variant.color}`)
  if (variant.style) parts.push(`Style: ${variant.style}`)
  return parts.join(', ')
}

export const Route = createFileRoute('/products/$slug')({
  headers: () => STOREFRONT_CACHE_HEADERS,
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
  const { addItem, itemCount } = useCart()

  const [selectedVariant, setSelectedVariant] = useState<
    VariantWithStock | undefined
  >()
  const [quantity, setQuantity] = useState(1)
  const [isAdding, setIsAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addedItem, setAddedItem] = useState<AddedToCartItem | null>(null)

  const availableStock =
    selectedVariant?.inventory.reduce(
      (sum, inv) => sum + inv.quantity_available,
      0,
    ) ?? 0
  const outOfStock = Boolean(selectedVariant) && availableStock <= 0

  async function handleAddToCart() {
    if (!selectedVariant || outOfStock) return
    setError(null)
    setAddedItem(null)
    setIsAdding(true)
    try {
      await addItem(selectedVariant.id, quantity)
      setAddedItem({
        image: product.images[0] ?? null,
        productName: product.name,
        variantLabel: formatVariantLabel(selectedVariant),
      })
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
      {addedItem && (
        <AddedToCartPopup
          item={addedItem}
          itemCount={itemCount}
          onClose={() => setAddedItem(null)}
        />
      )}

      <div className="grid grid-cols-1 gap-10 md:grid-cols-4">
        {/* Title + rating (+ description on desktop, nested in the same
            column so it fills the whitespace under the rating instead of
            being placed as a sibling grid item — a separate item here
            positioned via col-start would get auto-placed into whatever row
            the browser picks next, which (since the gallery column is much
            taller) landed below the entire gallery instead of directly
            under the title. Nesting keeps this column's height independent
            of the gallery's. */}
        <div className="md:col-span-1">
          <h1 className="text-3xl font-bold tracking-tight">{product.name}</h1>
          <ProductRatingSummary
            averageRating={reviews.averageRating}
            reviewCount={reviews.reviewCount}
          />
          {product.description && (
            <div className="mt-6 hidden md:block">
              <p className="whitespace-pre-line text-neutral-600 dark:text-neutral-400">
                {product.description}
              </p>
            </div>
          )}
        </div>

        {/* Mockup */}
        <div className="md:col-span-2 md:mt-12">
          <ImageGallery images={product.images} alt={product.name} />
        </div>

        {/* Buying selection (+ reviews on desktop, same nesting reasoning as description above) */}
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

          {error && (
            <p className="mt-3 text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          )}

          <PaymentBadges />

          <div className="hidden md:block">
            <ProductReviewsList reviews={reviews.reviews} />
          </div>
        </div>
      </div>

      {/* Mobile-only: description and reviews render again here (hidden on
          desktop) in a sensible top-to-bottom order — image gallery before
          description/reviews — since on a single mobile column, nesting
          them under title/buy-box like above would push the description
          ahead of the product photos. */}
      <div className="mt-10 md:hidden">
        {product.description && (
          <p className="whitespace-pre-line text-neutral-600 dark:text-neutral-400">
            {product.description}
          </p>
        )}
        <ProductReviewsList reviews={reviews.reviews} />
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

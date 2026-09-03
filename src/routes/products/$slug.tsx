import { useEffect, useRef, useState } from 'react'
import {
  createFileRoute,
  notFound,
  useRouterState,
} from '@tanstack/react-router'
import { getProductPageData } from '#/server/products/product-page'
import { recordVisit } from '#/server/analytics/track'
import { getOrCreateVisitorId } from '#/lib/analytics/visitor-id'
import { trackPixelEvent } from '#/lib/analytics/facebook-pixel'
import { useCart } from '#/lib/cart/CartContext'
import { useCurrency } from '#/lib/currency/CurrencyContext'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import type { Translations } from '#/lib/i18n/translations'
import {
  centsToMajorUnits,
  convertCents,
  effectiveCurrency,
} from '#/lib/utils/money'
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

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function formatVariantLabel(
  t: Translations,
  variant: VariantWithStock,
): string {
  const parts: string[] = []
  if (variant.size)
    parts.push(`${capitalize(t.product.size)}: ${formatSizeLabel(variant.size)}`)
  if (variant.color)
    parts.push(`${capitalize(t.product.color)}: ${variant.color}`)
  if (variant.style)
    parts.push(`${capitalize(t.product.style)}: ${variant.style}`)
  return parts.join(', ')
}

export const Route = createFileRoute('/products/$slug')({
  headers: () => STOREFRONT_CACHE_HEADERS,
  loader: async ({ params, context }) => {
    // A single createServerFn call instead of 3 separate ones — see
    // server/products/product-page.ts for why that's a real reduction in
    // Vercel requests, not just code shape.
    const { product, related, reviews } = await getProductPageData({
      data: { slug: params.slug, brand: context.storefrontScope.brand },
    })
    if (!product) throw notFound()

    return { product, related, reviews }
  },
  component: ProductPage,
})

function ProductPage() {
  const { product, related, reviews } = Route.useLoaderData()
  const { storefrontScope } = Route.useRouteContext()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { addItem, itemCount, subtotalCents, discountCents } = useCart()
  const {
    currency,
    rates,
    formatPriceWithMarkup: formatPrice,
    freeShippingProgressForBrowsing,
  } = useCurrency()
  const { t, language } = useLanguage()

  const [selectedVariant, setSelectedVariant] = useState<
    VariantWithStock | undefined
  >()
  const [quantity, setQuantity] = useState(1)
  const [isAdding, setIsAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addedItem, setAddedItem] = useState<AddedToCartItem | null>(null)

  useEffect(() => {
    const lowestPriceCents = Math.min(
      ...product.variants.map((v) => v.price_cents),
    )
    const target = effectiveCurrency(currency, rates)
    trackPixelEvent('ViewContent', {
      content_ids: [product.id],
      content_type: 'product',
      content_name: product.name,
      value: centsToMajorUnits(
        convertCents(lowestPriceCents, target, rates),
        target,
      ),
      currency: target,
    })
    // Only re-fire if the visitor lands on a different product's page —
    // deliberately excludes currency/rates so switching currency mid-visit
    // doesn't double-count this event; it just reflects whatever currency
    // was active the moment the product page was viewed.
  }, [product.id])

  // Description and reviews sit in boxes capped to a fixed height so long
  // content scrolls instead of growing the page — but the title/rating
  // block above the description isn't the same height as the size
  // selector/payment badges block above reviews, so giving both boxes the
  // *same* fixed height doesn't make their bottoms line up. Measuring the
  // actual rendered height of each "header" (and the gallery, which sets
  // the target both columns should reach) lets each box's height be
  // computed so both columns bottom out at the same point regardless of
  // how tall either header happens to be.
  const galleryRef = useRef<HTMLDivElement>(null)
  const leftHeaderRef = useRef<HTMLDivElement>(null)
  const rightHeaderRef = useRef<HTMLDivElement>(null)
  const [boxHeights, setBoxHeights] = useState<{
    left: number
    right: number
  } | null>(null)

  useEffect(() => {
    function measure() {
      const galleryHeight = galleryRef.current?.offsetHeight ?? 0
      if (!galleryHeight) return
      const leftHeaderHeight = leftHeaderRef.current?.offsetHeight ?? 0
      const rightHeaderHeight = rightHeaderRef.current?.offsetHeight ?? 0
      setBoxHeights({
        left: Math.max(galleryHeight - leftHeaderHeight, 160),
        right: Math.max(galleryHeight - rightHeaderHeight, 160),
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Hand-translated per product (products.description_ja/description_ko/
  // description_zh — see admin/products/$productId.tsx) — falls back to the English
  // description whenever a product hasn't had its translation filled in
  // yet, rather than showing nothing.
  const localizedDescription =
    (language === 'ja'
      ? product.description_ja
      : language === 'ko'
        ? product.description_ko
        : language === 'zh'
          ? product.description_zh
          : null) || product.description

  // Shown next to the title so a price is always visible, even before the
  // shopper has picked a variant — falls back to the cheapest active
  // variant, then reflects whichever one they actually select.
  const displayVariant =
    selectedVariant ??
    product.variants
      .filter((v) => v.is_active)
      .reduce<VariantWithStock | undefined>(
        (lowest, v) =>
          !lowest || v.price_cents < lowest.price_cents ? v : lowest,
        undefined,
      )

  const availableStock =
    selectedVariant?.inventory.reduce(
      (sum, inv) => sum + inv.quantity_available,
      0,
    ) ?? 0
  // Real stock always wins if there's any — a variant marked pre-order
  // that's since been restocked sells as a normal item again (matches
  // getActiveVariantStock's own rule server-side).
  const sellingAsPreOrder =
    Boolean(selectedVariant) &&
    availableStock <= 0 &&
    Boolean(selectedVariant?.is_pre_order) &&
    (selectedVariant?.pre_order_available ?? 0) > 0
  const purchasableQuantity = sellingAsPreOrder
    ? (selectedVariant?.pre_order_available ?? 0)
    : availableStock
  const outOfStock =
    Boolean(selectedVariant) && purchasableQuantity <= 0

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
        variantLabel: formatVariantLabel(t, selectedVariant),
      })
      const target = effectiveCurrency(currency, rates)
      trackPixelEvent('AddToCart', {
        content_ids: [product.id],
        content_type: 'product',
        content_name: product.name,
        value: centsToMajorUnits(
          convertCents(selectedVariant.price_cents * quantity, target, rates),
          target,
        ),
        currency: target,
      })
      void recordVisit({
        data: {
          visitorId: getOrCreateVisitorId(),
          path: pathname,
          eventType: 'checkout_start',
          productId: product.id,
          metadata: { variantId: selectedVariant.id, quantity },
          brand: storefrontScope.brand,
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
          freeShippingProgress={freeShippingProgressForBrowsing(
            subtotalCents - discountCents,
            itemCount,
          )}
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
            of the gallery's.

            The description/reviews boxes are height-capped via the
            boxHeights computed above (gallery height minus each column's
            own "header" height) rather than a shared fixed value — the
            title+rating block and the size-selector+payment-badges block
            are different heights, so a shared fixed box height left their
            bottoms misaligned. Falls back to a fixed 26rem before the
            measurement effect runs (first paint / no-JS). */}
        <div className="md:col-span-1">
          <div ref={leftHeaderRef}>
            <h1 className="text-3xl font-bold tracking-tight">
              {product.name}
            </h1>
            <ProductRatingSummary
              averageRating={reviews.averageRating}
              reviewCount={reviews.reviewCount}
            />
            {sellingAsPreOrder && !outOfStock && (
              <span className="mt-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-400">
                Pre-Order
              </span>
            )}
            {displayVariant &&
              (displayVariant.salePriceCents != null &&
              displayVariant.salePriceCents < displayVariant.price_cents ? (
                <p className="mt-2 text-2xl font-semibold text-red-600 dark:text-red-400">
                  {formatPrice(displayVariant.salePriceCents)}
                  <span className="ml-2 text-base font-normal text-neutral-400 line-through dark:text-neutral-600">
                    {formatPrice(displayVariant.price_cents)}
                  </span>
                </p>
              ) : (
                <p className="mt-2 text-2xl font-semibold text-neutral-900 dark:text-white">
                  {formatPrice(displayVariant.price_cents)}
                  {displayVariant.compare_at_price_cents != null &&
                    displayVariant.compare_at_price_cents >
                      displayVariant.price_cents && (
                      <span className="ml-2 text-base font-normal text-neutral-400 line-through dark:text-neutral-600">
                        {formatPrice(displayVariant.compare_at_price_cents)}
                      </span>
                    )}
                </p>
              ))}
          </div>
          {localizedDescription && (
            <div
              dir="rtl"
              className="mt-6 hidden md:block md:overflow-y-auto md:pl-3"
              style={{ height: boxHeights ? boxHeights.left : '26rem' }}
            >
              <p
                dir="ltr"
                className="whitespace-pre-line text-neutral-600 dark:text-neutral-400"
              >
                {localizedDescription}
              </p>
            </div>
          )}
        </div>

        {/* Mockup */}
        <div ref={galleryRef} className="md:col-span-2 md:mt-12">
          <ImageGallery images={product.images} alt={product.name} />
        </div>

        {/* Buying selection (+ reviews on desktop, same reasoning as the title column above) */}
        <div className="md:col-span-1">
          <div ref={rightHeaderRef}>
            <VariantSelector
              variants={product.variants}
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
                    setQuantity((q) =>
                      Math.min(20, purchasableQuantity || 20, q + 1),
                    )
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
                  ? t.product.outOfStock
                  : !selectedVariant
                    ? t.product.selectOptions
                    : isAdding
                      ? t.product.adding
                      : sellingAsPreOrder
                        ? 'Pre-Order'
                        : t.product.addToCart}
              </button>
            </div>

            {sellingAsPreOrder && !outOfStock && (
              <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
                This is a pre-order —{' '}
                {selectedVariant?.pre_order_arrival_note ||
                  'ships once stock arrives'}
                . Can't be checked out with regular in-stock items, and Cash
                on Delivery isn't available for it.
              </p>
            )}

            {error && (
              <p className="mt-3 text-sm text-red-700 dark:text-red-400">
                {error}
              </p>
            )}

            <PaymentBadges />
          </div>

          <div className="hidden md:block">
            <ProductReviewsList
              reviews={reviews.reviews}
              mode="scroll"
              maxHeightPx={boxHeights?.right}
            />
          </div>
        </div>
      </div>

      {/* Mobile-only: description and reviews render again here (hidden on
          desktop) in a sensible top-to-bottom order — image gallery before
          description/reviews — since on a single mobile column, nesting
          them under title/buy-box like above would push the description
          ahead of the product photos. */}
      <div className="mt-10 md:hidden">
        {localizedDescription && (
          <p className="whitespace-pre-line text-neutral-600 dark:text-neutral-400">
            {localizedDescription}
          </p>
        )}
        <ProductReviewsList reviews={reviews.reviews} mode="paginate" />
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

import { Link } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useCurrency } from '#/lib/currency/CurrencyContext'
import { optimizedImageUrl } from '#/lib/utils/image-optimize'
import { badgeOutOfStockClassName } from './ui'
import type {
  StorefrontListingProduct,
  WithSalePrice,
} from '#/server/products/queries'

interface ProductCardProps {
  product: StorefrontListingProduct & Partial<WithSalePrice>
}

/** Horizontally-scrolling image carousel for a product card — swipe on
 *  touch (native scroll-snap, so a real swipe is consumed by the browser's
 *  own scroll gesture and never fires a click, while a plain tap still
 *  falls through to the card's outer Link), dot indicators to jump to a
 *  specific image on any input (their onClick calls preventDefault so a dot
 *  click doesn't also navigate). */
function ProductCardImages({
  images,
  name,
}: {
  images: string[]
  name: string
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  if (images.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-neutral-400 dark:text-neutral-600">
        No image
      </div>
    )
  }

  function scrollToIndex(index: number) {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' })
    setActiveIndex(index)
  }

  function handleScroll() {
    const el = scrollRef.current
    if (!el || el.clientWidth === 0) return
    setActiveIndex(Math.round(el.scrollLeft / el.clientWidth))
  }

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto transition duration-300 group-hover:scale-105 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((url, i) => (
          <img
            key={url}
            src={optimizedImageUrl(url, 640)}
            alt={i === 0 ? name : ''}
            loading="lazy"
            draggable={false}
            className="h-full w-full flex-none snap-start object-contain"
          />
        ))}
      </div>
      {images.length > 1 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Show image ${i + 1} of ${images.length}`}
              onClick={(e) => {
                e.preventDefault()
                scrollToIndex(i)
              }}
              className={`pointer-events-auto size-1.5 rounded-full transition ${
                i === activeIndex
                  ? 'bg-neutral-900 dark:bg-white'
                  : 'bg-neutral-900/30 dark:bg-white/50'
              }`}
            />
          ))}
        </div>
      )}
    </>
  )
}

export function ProductCard({ product }: ProductCardProps) {
  const { formatPriceWithMarkup: formatPrice } = useCurrency()
  // is_pre_order is an explicit staff choice and wins outright — the badge
  // shows whenever any variant is flagged pre-order, regardless of how much
  // real stock the product otherwise has on hand.
  const isPreOrder = product.has_pre_order_stock
  const outOfStock = !isPreOrder && product.total_stock <= 0
  const onSale =
    product.salePriceCents != null &&
    product.salePriceCents < product.min_price_cents

  return (
    // preload={false} overrides the router's site-wide `intent` default —
    // this is the one link type dense enough (a grid can show 24+ at once)
    // that hover/touch-intent preloading turns into real cost: measured
    // live, hovering 5 product cards with zero clicks fired 10 full
    // backend loads (root + product data, the latter alone ~6 Supabase
    // queries) for products nobody selected. Every other link on the site
    // (nav, footer, a handful of related-product cards) stays low-density
    // enough that intent preloading is still worth it there.
    <Link
      to="/products/$slug"
      params={{ slug: product.slug }}
      preload={false}
      className="group block"
    >
      <div className="relative aspect-square overflow-hidden rounded-xl bg-neutral-100 dark:bg-neutral-900">
        <ProductCardImages images={product.images} name={product.name} />
        {isPreOrder ? (
          <span className="absolute top-3 left-3 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
            Pre-Order
          </span>
        ) : (
          outOfStock && (
            <span className={`absolute left-3 top-3 ${badgeOutOfStockClassName}`}>
              Out of stock
            </span>
          )
        )}
        {!outOfStock && onSale && (
          <span className="absolute left-3 top-3 rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
            Sale
          </span>
        )}
      </div>
      <div className="mt-3 space-y-0.5">
        <p className="text-sm font-medium text-neutral-900 dark:text-white">
          {product.name}
        </p>
        {onSale ? (
          <p className="flex items-center gap-1.5 text-sm">
            <span className="text-red-600 dark:text-red-400">
              {formatPrice(product.salePriceCents!)}
            </span>
            <span className="text-neutral-400 line-through dark:text-neutral-600">
              {formatPrice(product.min_price_cents)}
            </span>
          </p>
        ) : (
          <p className="text-[color:var(--price-text-light,#737373)] text-sm dark:text-[color:var(--price-text-dark,#a3a3a3)]">
            {formatPrice(product.min_price_cents)}
          </p>
        )}
      </div>
    </Link>
  )
}

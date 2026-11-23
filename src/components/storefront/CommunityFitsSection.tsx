import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, ShoppingBag } from 'lucide-react'
import { optimizedImageUrl } from '#/lib/utils/image-optimize'
import type { StorefrontCommunityFit } from '#/server/storefront/community-fits'

// One of vercel.json's images.sizes — a tile is at most ~1/2 of a phone
// screen or ~1/5 of a desktop one, so 640 covers 2x density on both.
const TILE_IMAGE_WIDTH = 640

/**
 * Spades-only "COMMUNITY FITS" carousel: Instagram posts where customers
 * tagged Spades. Native horizontal scrolling with scroll-snap (so touch
 * swipe is the browser's own, smooth and accessible), 2 tiles per view on
 * mobile and 5 on desktop, plus arrow buttons on desktop.
 */
export function CommunityFitsSection({
  fits,
}: {
  fits: StorefrontCommunityFit[]
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(false)

  const updateArrows = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    setCanPrev(el.scrollLeft > 4)
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    updateArrows()
    window.addEventListener('resize', updateArrows)
    return () => window.removeEventListener('resize', updateArrows)
  }, [updateArrows, fits.length])

  function scrollByPage(direction: -1 | 1) {
    const el = trackRef.current
    if (!el) return
    el.scrollBy({ left: direction * el.clientWidth, behavior: 'smooth' })
  }

  if (fits.length === 0) return null

  const arrowClassName =
    'absolute top-1/2 z-10 hidden -translate-y-1/2 items-center justify-center rounded-full bg-white/90 p-2 text-neutral-950 shadow-md transition hover:bg-white disabled:pointer-events-none disabled:opacity-0 lg:flex'

  return (
    <section
      aria-labelledby="community-fits-heading"
      className="bg-black py-12 text-white sm:py-16"
    >
      <h2
        id="community-fits-heading"
        className="mb-8 px-6 text-center text-2xl font-black uppercase tracking-tight sm:mb-10 sm:text-3xl"
      >
        Community Fits
      </h2>

      <div className="relative">
        <button
          type="button"
          aria-label="Previous posts"
          onClick={() => scrollByPage(-1)}
          disabled={!canPrev}
          className={`${arrowClassName} left-3`}
        >
          <ChevronLeft size={22} />
        </button>

        <div
          ref={trackRef}
          onScroll={updateArrows}
          className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {fits.map((fit) => (
            <div
              key={fit.id}
              className="w-1/2 shrink-0 snap-start px-px lg:w-1/5"
            >
              <a
                href={fit.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`View @${fit.handle}'s post on Instagram`}
                className="group relative block overflow-hidden"
              >
                <div className="aspect-[4/5] overflow-hidden bg-neutral-900">
                  <img
                    src={optimizedImageUrl(fit.imageUrl, TILE_IMAGE_WIDTH)}
                    alt={`Spades fit by @${fit.handle}`}
                    loading="lazy"
                    draggable={false}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                </div>
                <span className="pointer-events-none absolute right-2 bottom-2 left-2 truncate rounded-md bg-white/90 px-2 py-1 text-xs font-semibold text-neutral-950 shadow-sm sm:right-auto sm:max-w-[calc(100%-1rem)]">
                  @{fit.handle}
                </span>
              </a>
              {fit.products.length > 0 && (
                <ShopTheLook products={fit.products} />
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          aria-label="More posts"
          onClick={() => scrollByPage(1)}
          disabled={!canNext}
          className={`${arrowClassName} right-3`}
        >
          <ChevronRight size={22} />
        </button>
      </div>
    </section>
  )
}

/** "Shop: <first product>" link under a tile, plus "+N" when the photo has
 *  more tagged products — a 2-up phone tile only has room for one name. */
function ShopTheLook({
  products,
}: {
  products: StorefrontCommunityFit['products']
}) {
  const [first, ...rest] = products
  return (
    <div className="flex items-center gap-1 px-1.5 pt-2 text-xs">
      <Link
        to="/products/$slug"
        params={{ slug: first.slug }}
        preload={false}
        className="flex min-w-0 items-center gap-1 font-semibold text-white hover:underline"
      >
        <ShoppingBag size={13} className="shrink-0" aria-hidden />
        <span className="truncate">
          <span className="text-neutral-400">Shop:</span> {first.name}
        </span>
      </Link>
      {rest.length > 0 && (
        <Link
          to="/products/$slug"
          params={{ slug: rest[0].slug }}
          preload={false}
          title={rest.map((p) => p.name).join(', ')}
          className="shrink-0 rounded-full border border-white/30 px-1.5 text-[11px] text-neutral-300 hover:border-white hover:text-white"
        >
          +{rest.length} more
        </Link>
      )}
    </div>
  )
}

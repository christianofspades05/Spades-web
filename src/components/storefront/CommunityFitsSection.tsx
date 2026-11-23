import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, ShoppingBag, X } from 'lucide-react'
import { optimizedImageUrl } from '#/lib/utils/image-optimize'
import type { StorefrontCommunityFit } from '#/server/storefront/community-fits'

// One of vercel.json's images.sizes — a tile is ~1/2 of a phone screen or
// ~1/3 of a desktop one (up to ~640 CSS px), so 1080 stays sharp on both.
const TILE_IMAGE_WIDTH = 1080
// Full-size view — also one of vercel.json's images.sizes, and the width
// the admin upload already resizes photos down to.
const FULL_IMAGE_WIDTH = 1200
// Small product photos under a tile (~30% of a tile, so under 130px wide).
const PRODUCT_THUMB_WIDTH = 256
// Auto-advance a full page (2 photos on mobile, 3 on desktop) at a time,
// looping back to the start at the end.
const AUTOPLAY_INTERVAL_MS = 3000
// After someone swipes/taps/clicks an arrow, hold off auto-advancing for a
// bit so the carousel doesn't move out from under them.
const AUTOPLAY_RESUME_AFTER_MS = 6000

/**
 * Spades-only "COMMUNITY FITS" carousel: Instagram posts where customers
 * tagged Spades. Native horizontal scrolling with scroll-snap (so touch
 * swipe is the browser's own, smooth and accessible), 2 tiles per view on
 * mobile and 3 on desktop, plus arrow buttons on desktop. Tapping a photo
 * opens it full-size in a viewer; tapping the @handle opens the Instagram
 * post. Auto-advances every 3s while on screen, pausing on hover, after
 * any interaction, while the viewer is open, and for reduced-motion users.
 */
export function CommunityFitsSection({
  fits,
}: {
  fits: StorefrontCommunityFit[]
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(false)
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const hoveringRef = useRef(false)
  const lastInteractionRef = useRef(0)
  const onScreenRef = useRef(false)

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

  const markInteraction = useCallback(() => {
    lastInteractionRef.current = Date.now()
  }, [])

  useEffect(() => {
    const el = trackRef.current
    if (!el || openIndex !== null) return
    // Both missing only in non-browser test environments (jsdom).
    if (
      !('IntersectionObserver' in window) ||
      !('matchMedia' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreenRef.current = entry.isIntersecting
      },
      { threshold: 0.3 },
    )
    observer.observe(el)

    const timer = window.setInterval(() => {
      if (
        !onScreenRef.current ||
        hoveringRef.current ||
        document.hidden ||
        Date.now() - lastInteractionRef.current < AUTOPLAY_RESUME_AFTER_MS
      ) {
        return
      }
      const maxScroll = el.scrollWidth - el.clientWidth
      if (maxScroll <= 4) return // everything already fits on screen
      if (el.scrollLeft >= maxScroll - 4) {
        el.scrollTo({ left: 0, behavior: 'smooth' })
      } else {
        // One full screen of photos — same as tapping the arrow.
        el.scrollBy({ left: el.clientWidth, behavior: 'smooth' })
      }
    }, AUTOPLAY_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
      observer.disconnect()
    }
  }, [openIndex, fits.length])

  function scrollByPage(direction: -1 | 1) {
    markInteraction()
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
      className="bg-black py-14 text-white sm:py-20"
    >
      <h2
        id="community-fits-heading"
        className="mb-8 px-6 text-center text-sm font-bold uppercase tracking-[0.2em]"
      >
        Community Fits
      </h2>

      <div
        className="relative"
        onMouseEnter={() => {
          hoveringRef.current = true
        }}
        onMouseLeave={() => {
          hoveringRef.current = false
        }}
        onPointerDown={markInteraction}
        onTouchStart={markInteraction}
        onWheel={markInteraction}
        onFocus={markInteraction}
      >
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
          {fits.map((fit, index) => (
            <div
              key={fit.id}
              className="w-1/2 shrink-0 snap-start px-px lg:w-1/3"
            >
              <div className="relative overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenIndex(index)}
                  aria-label={`View @${fit.handle}'s photo`}
                  className="group block w-full cursor-zoom-in"
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
                </button>
                <HandleLink
                  fit={fit}
                  className="absolute right-2 bottom-2 left-2 truncate rounded-md bg-white/90 px-2 py-1 text-xs font-semibold text-neutral-950 shadow-sm hover:bg-white"
                />
              </div>
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

      {openIndex !== null && fits[openIndex] && (
        <FitViewer
          fits={fits}
          index={openIndex}
          onChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </section>
  )
}

/** The poster's @handle, linking to the original Instagram post. */
function HandleLink({
  fit,
  className,
}: {
  fit: StorefrontCommunityFit
  className: string
}) {
  return (
    <a
      href={fit.instagramUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`@${fit.handle} on Instagram`}
      className={className}
    >
      @{fit.handle}
    </a>
  )
}

/** Under a tile: "Shop: <first product>" plus a small swipeable row of every
 *  tagged product's photo, each linking to its product page. */
function ShopTheLook({
  products,
}: {
  products: StorefrontCommunityFit['products']
}) {
  const [first] = products
  return (
    <div className="px-1.5 pt-2">
      <Link
        to="/products/$slug"
        params={{ slug: first.slug }}
        preload={false}
        className="flex min-w-0 items-center gap-1 text-xs font-semibold text-white hover:underline"
      >
        <ShoppingBag size={13} className="shrink-0" aria-hidden />
        <span className="truncate">
          <span className="text-neutral-400">Shop:</span> {first.name}
        </span>
      </Link>
      <div className="mt-2 flex gap-1.5 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {products.map((product) => (
          <Link
            key={product.id}
            to="/products/$slug"
            params={{ slug: product.slug }}
            preload={false}
            title={product.name}
            aria-label={product.name}
            className="block w-[30%] shrink-0 overflow-hidden bg-white transition hover:opacity-80"
          >
            <div className="aspect-square">
              {product.image ? (
                <img
                  src={optimizedImageUrl(product.image, PRODUCT_THUMB_WIDTH)}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center p-1 text-center text-[10px] text-neutral-500">
                  {product.name}
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

/** Full-screen photo viewer: the whole photo (uncropped), the @handle and
 *  every tagged product, with prev/next. Closes on Escape, the X, or a tap
 *  on the dark backdrop. */
function FitViewer({
  fits,
  index,
  onChange,
  onClose,
}: {
  fits: StorefrontCommunityFit[]
  index: number
  onChange: (index: number) => void
  onClose: () => void
}) {
  const fit = fits[index]
  const closeRef = useRef<HTMLButtonElement>(null)
  const hasPrev = index > 0
  const hasNext = index < fits.length - 1

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && hasPrev) onChange(index - 1)
      else if (e.key === 'ArrowRight' && hasNext) onChange(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, hasPrev, hasNext, onChange, onClose])

  // Lock page scroll while open, and put focus inside the viewer.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  const navClassName =
    'absolute top-1/2 z-10 flex -translate-y-1/2 items-center justify-center rounded-full bg-white/15 p-2 text-white transition hover:bg-white/30'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Photo by @${fit.handle}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 p-4"
    >
      <button
        ref={closeRef}
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute top-3 right-3 z-10 rounded-full bg-white/15 p-2 text-white transition hover:bg-white/30"
      >
        <X size={22} />
      </button>

      {hasPrev && (
        <button
          type="button"
          aria-label="Previous photo"
          onClick={() => onChange(index - 1)}
          className={`${navClassName} left-2 sm:left-4`}
        >
          <ChevronLeft size={24} />
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          aria-label="Next photo"
          onClick={() => onChange(index + 1)}
          className={`${navClassName} right-2 sm:right-4`}
        >
          <ChevronRight size={24} />
        </button>
      )}

      <img
        key={fit.id}
        src={optimizedImageUrl(fit.imageUrl, FULL_IMAGE_WIDTH)}
        alt={`Spades fit by @${fit.handle}`}
        className="max-h-[75vh] max-w-full rounded-md object-contain"
      />

      <div className="mt-4 flex max-w-full flex-col items-center gap-2 text-center text-white">
        <HandleLink
          fit={fit}
          className="text-sm font-semibold text-white hover:underline"
        />
        {fit.products.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {fit.products.map((product) => (
              <Link
                key={product.id}
                to="/products/$slug"
                params={{ slug: product.slug }}
                preload={false}
                className="flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-neutral-950 hover:bg-neutral-200"
              >
                <ShoppingBag size={13} className="shrink-0" aria-hidden />
                Shop: {product.name}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

import { useEffect, useRef } from 'react'

/** How much larger than its container the image renders — the extra size is the pan range. */
const IMAGE_SCALE = 1.3

interface ParallaxImageProps {
  src: string
  alt: string
  className?: string
  /** Axis the image pans along as the page scrolls. Defaults to vertical. */
  direction?: 'vertical' | 'horizontal'
}

/**
 * Renders an <img> that's IMAGE_SCALE× the size of its (relative,
 * overflow-hidden, fixed-height) parent along the pan axis, and pans it as
 * the parent scrolls through the viewport. The parent scrolls normally with
 * the page — only the image's position inside it moves.
 */
export function ParallaxImage({
  src,
  alt,
  className,
  direction = 'vertical',
}: ParallaxImageProps) {
  const imageRef = useRef<HTMLImageElement>(null)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const image = imageRef.current
    const container = image?.parentElement
    if (!image || !container) return

    function update() {
      frameRef.current = null
      if (!image || !container) return

      const rect = container.getBoundingClientRect()
      const viewportHeight = window.innerHeight
      // Progress goes 0 -> 1 as the section's top edge travels from the
      // bottom of the viewport to the top of it — one viewport-height of
      // scrolling. (Not (viewportHeight + rect.height), which needs the
      // section's bottom edge to clear the top of the viewport too — a
      // range that a short page with little content below the section,
      // like this one right before the footer, may never fully scroll
      // through, leaving the pan stuck near its starting position.)
      const progress =
        viewportHeight > 0 ? (viewportHeight - rect.top) / viewportHeight : 0.5
      const clamped = Math.min(1, Math.max(0, progress))
      // At progress 0 (section just entering view) show the start of the
      // image (its top/left edge); at progress 1 show the end of it (its
      // bottom/right edge) — i.e. pan through the image in reading order as
      // the user scrolls down, not backwards.
      const offset = (0.5 - clamped) * 2

      if (direction === 'horizontal') {
        const maxOffset = (rect.width * (IMAGE_SCALE - 1)) / 2
        image.style.transform = `translate3d(calc(-50% + ${(offset * maxOffset).toFixed(2)}px), -50%, 0)`
      } else {
        const maxOffset = (rect.height * (IMAGE_SCALE - 1)) / 2
        image.style.transform = `translate3d(0, calc(-50% + ${(offset * maxOffset).toFixed(2)}px), 0)`
      }
    }

    function onScrollOrResize() {
      if (frameRef.current == null) {
        frameRef.current = requestAnimationFrame(update)
      }
    }

    update()
    window.addEventListener('scroll', onScrollOrResize, { passive: true })
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize)
      window.removeEventListener('resize', onScrollOrResize)
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
    }
  }, [direction])

  const sizeStyle =
    direction === 'horizontal'
      ? { width: `${IMAGE_SCALE * 100}%`, height: '100%' }
      : { width: '100%', height: `${IMAGE_SCALE * 100}%` }

  const positionClassName =
    direction === 'horizontal'
      ? 'absolute left-1/2 top-0'
      : 'absolute left-0 top-1/2'

  return (
    <img
      ref={imageRef}
      src={src}
      alt={alt}
      className={`${positionClassName} object-cover ${className ?? ''}`}
      style={{
        ...sizeStyle,
        transform:
          direction === 'horizontal'
            ? 'translate3d(-50%, -50%, 0)'
            : 'translate3d(0, -50%, 0)',
      }}
    />
  )
}

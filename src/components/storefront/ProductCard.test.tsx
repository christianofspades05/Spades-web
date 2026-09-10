// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup, within } from '@testing-library/react'
import { ProductCard } from './ProductCard'
import type {
  StorefrontListingProduct,
  WithSalePrice,
} from '#/server/products/queries'

// jsdom doesn't implement scrollable-element APIs at all — this is a test
// environment gap, not app behavior; real scroll-snap/swipe is exercised by
// the live browser test, not here.
Element.prototype.scrollTo = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  // ProductCard only reads `to`/`params`/`preload`/`className` off this in
  // the outer Link — a plain anchor is enough to render and interact with
  // the carousel underneath it without needing a real router context. Real
  // click-through navigation is covered by the live browser test, not here.
  Link: ({
    children,
    className,
  }: {
    children: React.ReactNode
    className?: string
  }) => (
    <a href="#" className={className}>
      {children}
    </a>
  ),
}))

vi.mock('#/lib/currency/CurrencyContext', () => ({
  useCurrency: () => ({
    formatPriceWithMarkup: (cents: number) => `₱${(cents / 100).toFixed(2)}`,
  }),
}))

vi.mock('#/lib/utils/image-optimize', () => ({
  // Deterministic, inspectable output — real optimizedImageUrl behavior
  // (Vercel's /_vercel/image proxy) is exercised by the live browser test,
  // not this unit test.
  optimizedImageUrl: (src: string, width: number) => `${src}::w${width}`,
}))

function fakeProduct(
  overrides: Partial<StorefrontListingProduct & WithSalePrice> = {},
): StorefrontListingProduct & Partial<WithSalePrice> {
  return {
    id: 'p1',
    slug: 'test-product',
    name: 'Test Product',
    images: ['img1.jpg'],
    min_price_cents: 10000,
    total_stock: 5,
    has_pre_order_stock: false,
    salePriceCents: null,
    saleTitle: null,
    ...overrides,
  } as unknown as StorefrontListingProduct & Partial<WithSalePrice>
}

function imgSrcs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('img')).map((img) => img.src)
}

describe('ProductCard image activation', () => {
  // No global RTL setup file exists in this project (globals: true /
  // jest-dom aren't wired up), so cleanup between tests isn't automatic —
  // without this, a later test's `screen`-wide query can see DOM left over
  // from an earlier one.
  afterEach(cleanup)

  it('1. product with 6 images: initial render creates only the primary image', () => {
    const images = Array.from({ length: 6 }, (_, i) => `img${i}.jpg`)
    const { container } = render(
      <ProductCard product={fakeProduct({ images })} />,
    )

    expect(imgSrcs(container)).toEqual(['img0.jpg::w640'])
  })

  it('2. secondary images are not present before interaction', () => {
    const images = Array.from({ length: 6 }, (_, i) => `img${i}.jpg`)
    const { container } = render(
      <ProductCard product={fakeProduct({ images })} />,
    )

    for (let i = 1; i < 6; i++) {
      expect(imgSrcs(container)).not.toContain(`img${i}.jpg::w640`)
    }
  })

  it('3. hover (desktop) activates all secondary images for that card', () => {
    const images = Array.from({ length: 6 }, (_, i) => `img${i}.jpg`)
    const { container } = render(
      <ProductCard product={fakeProduct({ images })} />,
    )

    const scroller = container.querySelector('[class*="overflow-x-auto"]')!
    fireEvent.mouseEnter(scroller)

    expect(imgSrcs(container)).toEqual(images.map((url) => `${url}::w640`))
  })

  it('3b. touch (mobile) activates all secondary images for that card', () => {
    const images = Array.from({ length: 6 }, (_, i) => `img${i}.jpg`)
    const { container } = render(
      <ProductCard product={fakeProduct({ images })} />,
    )

    const scroller = container.querySelector('[class*="overflow-x-auto"]')!
    fireEvent.touchStart(scroller)

    expect(imgSrcs(container)).toEqual(images.map((url) => `${url}::w640`))
  })

  it('4. another (unhovered) ProductCard remains unactivated', () => {
    const imagesA = Array.from({ length: 6 }, (_, i) => `a-img${i}.jpg`)
    const imagesB = Array.from({ length: 6 }, (_, i) => `b-img${i}.jpg`)

    const { container: containerA } = render(
      <ProductCard
        product={fakeProduct({ id: 'a', slug: 'a', images: imagesA })}
      />,
    )
    const { container: containerB } = render(
      <ProductCard
        product={fakeProduct({ id: 'b', slug: 'b', images: imagesB })}
      />,
    )

    fireEvent.mouseEnter(
      containerA.querySelector('[class*="overflow-x-auto"]')!,
    )

    expect(imgSrcs(containerA)).toEqual(imagesA.map((u) => `${u}::w640`))
    // Card B never interacted with — must still show only its primary image.
    expect(imgSrcs(containerB)).toEqual(['b-img0.jpg::w640'])
  })

  it('5. clicking a dot for an unmounted slide activates and jumps to it', () => {
    const images = Array.from({ length: 3 }, (_, i) => `img${i}.jpg`)
    const { container } = render(
      <ProductCard product={fakeProduct({ images })} />,
    )

    expect(imgSrcs(container)).toEqual(['img0.jpg::w640'])

    const dots = within(container).getAllByRole('button', {
      name: /Show image/,
    })
    expect(dots).toHaveLength(3)
    fireEvent.click(dots[2])

    // Activation mounts every slide, including the one the dot asked for.
    expect(imgSrcs(container)).toEqual(images.map((u) => `${u}::w640`))
  })

  it('6. product with exactly one image behaves identically activated or not', () => {
    const { container } = render(
      <ProductCard product={fakeProduct({ images: ['only.jpg'] })} />,
    )

    expect(imgSrcs(container)).toEqual(['only.jpg::w640'])
    // No dots for a single-image product, matching prior behavior.
    expect(
      within(container).queryByRole('button', { name: /Show image/ }),
    ).toBeNull()

    fireEvent.mouseEnter(container.querySelector('[class*="overflow-x-auto"]')!)
    expect(imgSrcs(container)).toEqual(['only.jpg::w640'])
  })

  it('7. the card still renders as a link to the product page', () => {
    const { container } = render(
      <ProductCard product={fakeProduct({ slug: 'my-product' })} />,
    )
    expect(container.querySelector('a')).not.toBeNull()
  })

  it('8. image order is preserved after activation', () => {
    const images = ['first.jpg', 'second.jpg', 'third.jpg']
    const { container } = render(
      <ProductCard product={fakeProduct({ images })} />,
    )

    fireEvent.mouseEnter(container.querySelector('[class*="overflow-x-auto"]')!)

    expect(imgSrcs(container)).toEqual([
      'first.jpg::w640',
      'second.jpg::w640',
      'third.jpg::w640',
    ])
  })

  it('9. a product with zero images falls back to the existing empty state, not an error', () => {
    const { container } = render(
      <ProductCard product={fakeProduct({ images: [] })} />,
    )
    expect(container.textContent).toContain('No image')
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })

  it("9b. a failed primary image doesn't throw — no special handling existed before, and none is added", () => {
    const { container } = render(
      <ProductCard product={fakeProduct({ images: ['broken.jpg'] })} />,
    )
    const img = container.querySelector('img')!
    expect(() => fireEvent.error(img)).not.toThrow()
    // Still exactly the one (now-broken) <img> — nothing replaced it.
    expect(imgSrcs(container)).toEqual(['broken.jpg::w640'])
  })

  it('9c. a failed secondary image after activation does not break the rest of the carousel', () => {
    const images = ['a.jpg', 'b.jpg', 'c.jpg']
    const { container } = render(
      <ProductCard product={fakeProduct({ images })} />,
    )
    fireEvent.mouseEnter(container.querySelector('[class*="overflow-x-auto"]')!)

    const imgs = container.querySelectorAll('img')
    expect(imgs).toHaveLength(3)
    expect(() => fireEvent.error(imgs[1])).not.toThrow()
    // All three slides remain mounted — one broken image doesn't remove
    // its siblings or collapse the carousel.
    expect(imgSrcs(container)).toEqual(images.map((u) => `${u}::w640`))
  })
})

import { createFileRoute, Link } from '@tanstack/react-router'
import { listActiveProducts } from '#/server/products/queries'
import { ProductGrid } from '#/components/storefront/ProductGrid'
import { buttonPrimaryClassName } from '#/components/storefront/ui'
import { toListingProduct } from '#/lib/utils/product-shape'
import { loadStorefrontCollectionSections } from '#/server/collections/sections'
import { CollectionSections } from '#/components/storefront/CollectionSections'
import { STOREFRONT_CACHE_HEADERS } from '#/lib/utils/cache-control'

const FEATURED_PAGE_SIZE = 5
const BEST_SELLERS_SLUG = 'best-sellers'

export const Route = createFileRoute('/')({
  headers: () => STOREFRONT_CACHE_HEADERS,
  loader: async () => {
    const [bestSellers, collectionSections] = await Promise.all([
      listActiveProducts({
        data: { collectionSlug: BEST_SELLERS_SLUG, limit: FEATURED_PAGE_SIZE },
      }),
      loadStorefrontCollectionSections(),
    ])
    return {
      featured: bestSellers.map(toListingProduct),
      collectionSections,
    }
  },
  component: Home,
})

function Home() {
  const { featured, collectionSections } = Route.useLoaderData()

  return (
    <div className="bg-white dark:bg-neutral-950">
      {/* Hero */}
      <Link
        to="/products"
        search={{ sort: 'newest', page: 1 }}
        className="block"
      >
        <img
          src="/home/hero.jpg"
          alt="Bet on yourself — Spades"
          className="h-auto w-full object-cover"
        />
      </Link>

      {/* Tagline / statement */}
      <section className="bg-neutral-950 py-12 text-center text-white sm:py-16">
        <div className="mx-auto max-w-2xl px-6">
          <h2 className="text-2xl font-black uppercase tracking-tight sm:text-3xl">
            Official Web Store
          </h2>
          <p className="mt-3 text-sm text-neutral-300 sm:text-base">
            Everyone has an ambitious goal that we must gamble our own time to
            achieve
          </p>
        </div>
      </section>

      {/* Photo collage */}
      <img
        src="/home/collage.jpg"
        alt="Spades apparel"
        className="h-auto w-full object-cover"
      />

      {/* Best sellers */}
      <section className="mx-auto max-w-6xl px-6 py-14 sm:py-20">
        <h2 className="mb-8 text-center text-sm font-bold uppercase tracking-[0.2em] text-neutral-950 dark:text-white">
          Best Sellers
        </h2>
        <ProductGrid
          products={featured}
          emptyMessage="No products yet."
          columns={5}
        />
        <div className="mt-10 flex justify-center">
          <Link
            to="/collections/$slug"
            params={{ slug: BEST_SELLERS_SLUG }}
            className={buttonPrimaryClassName}
          >
            View all
          </Link>
        </div>
      </section>

      {/* Gamblers Club statement */}
      <video
        src="/home/statement.mp4"
        poster="/home/statement-poster.jpg"
        className="aspect-video w-full object-cover"
        autoPlay
        loop
        muted
        playsInline
      />

      {/* Collections */}
      <section className="mx-auto max-w-6xl px-6 py-14 sm:py-20">
        <h2 className="mb-12 text-center text-2xl font-black uppercase tracking-tight dark:text-white">
          Collections
        </h2>
        <CollectionSections sections={collectionSections} />
      </section>
    </div>
  )
}

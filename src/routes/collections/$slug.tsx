import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import {
  listActiveProducts,
  OTHER_BRAND_COLLECTION_SLUGS,
} from '#/server/products/queries'
import { toListingProduct } from '#/lib/utils/product-shape'
import { collectionTitleForSlug } from '#/lib/collections/display'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import { ProductGrid } from '#/components/storefront/ProductGrid'
import { STOREFRONT_CACHE_HEADERS } from '#/lib/utils/cache-control'

const PRODUCTS_PER_ROW = 5
/** listActiveProducts caps limit at 100 (see listActiveProductsSchema). */
const FETCH_LIMIT = 100

export const Route = createFileRoute('/collections/$slug')({
  headers: () => STOREFRONT_CACHE_HEADERS,
  loader: async ({ params, context }) => {
    // Locked to one brand's collection (see server/storefront/domain.ts) —
    // any other collection's URL doesn't exist on this domain. Spades has
    // no collection of its own (collectionSlug is null — the unscoped
    // catalog), but must still 404 on another brand's *own* collection
    // (e.g. /collections/ysrael), or that brand's exclusive products would
    // be reachable by URL even though they're excluded from browsing/search.
    const { collectionSlug } = context.storefrontScope
    if (collectionSlug) {
      if (params.slug !== collectionSlug) throw notFound()
    } else if (
      (OTHER_BRAND_COLLECTION_SLUGS as readonly string[]).includes(params.slug)
    ) {
      throw notFound()
    }

    const products = await listActiveProducts({
      data: { collectionSlug: params.slug, limit: FETCH_LIMIT },
    })
    return {
      slug: params.slug,
      products: products.map(toListingProduct),
      isScoped: collectionSlug !== null,
    }
  },
  component: CollectionDetailPage,
})

function CollectionDetailPage() {
  const { slug, products, isScoped } = Route.useLoaderData()
  const { t } = useLanguage()

  return (
    <div className="mx-auto max-w-6xl px-6 py-14 sm:py-20">
      <div className="mb-10 flex items-center justify-between">
        <h1 className="text-3xl font-black uppercase tracking-tight">
          {collectionTitleForSlug(slug, t)}
        </h1>
        {!isScoped && (
          <Link
            to="/collections"
            className="text-sm text-neutral-600 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"
          >
            {t.collections.allCollections}
          </Link>
        )}
      </div>
      <ProductGrid
        products={products}
        emptyMessage={t.collections.noProductsInCollection}
        columns={PRODUCTS_PER_ROW}
      />
    </div>
  )
}

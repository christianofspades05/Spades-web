import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { listStorefrontProducts } from '#/server/products/queries'
import { pesosToCents } from '#/lib/utils/money'
import {
  productListingSearchSchema,
  PRODUCT_LISTING_PAGE_SIZE,
} from '#/lib/validation/product-listing'
import { ProductGrid } from '#/components/storefront/ProductGrid'
import { ProductFilters } from '#/components/storefront/ProductFilters'
import { SortSelect } from '#/components/storefront/SortSelect'
import { SearchBar } from '#/components/storefront/SearchBar'
import { Pagination } from '#/components/storefront/Pagination'

export const Route = createFileRoute('/products/')({
  validateSearch: productListingSearchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) =>
    listStorefrontProducts({
      data: {
        type: deps.type,
        q: deps.q,
        minPriceCents:
          deps.minPrice !== undefined ? pesosToCents(deps.minPrice) : undefined,
        maxPriceCents:
          deps.maxPrice !== undefined ? pesosToCents(deps.maxPrice) : undefined,
        inStock: deps.inStock,
        sort: deps.sort,
        page: deps.page,
        pageSize: PRODUCT_LISTING_PAGE_SIZE,
      },
    }),
  component: ProductsPage,
})

function ProductsPage() {
  const { products, total } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const totalPages = Math.max(1, Math.ceil(total / PRODUCT_LISTING_PAGE_SIZE))

  return (
    <div className="mx-auto max-w-6xl bg-white px-6 py-12 dark:bg-neutral-950">
      <h1 className="text-3xl font-bold tracking-tight dark:text-white">
        All Products
      </h1>

      <div className="mt-8 grid grid-cols-1 gap-10 md:grid-cols-[240px_1fr]">
        <aside className="space-y-8">
          <SearchBar
            value={search.q ?? ''}
            onChange={(q) =>
              navigate({
                search: (prev) => ({ ...prev, q: q || undefined, page: 1 }),
              })
            }
          />
          <ProductFilters
            type={search.type}
            minPrice={search.minPrice}
            maxPrice={search.maxPrice}
            inStock={search.inStock}
            onTypeChange={(type) =>
              navigate({ search: (prev) => ({ ...prev, type, page: 1 }) })
            }
            onPriceChange={(minPrice, maxPrice) =>
              navigate({
                search: (prev) => ({ ...prev, minPrice, maxPrice, page: 1 }),
              })
            }
            onInStockChange={(inStock) =>
              navigate({ search: (prev) => ({ ...prev, inStock, page: 1 }) })
            }
          />
        </aside>

        <div>
          <div className="mb-6 flex items-center justify-between gap-4">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {total} products
            </p>
            <SortSelect
              value={search.sort}
              onChange={(sort) =>
                navigate({ search: (prev) => ({ ...prev, sort, page: 1 }) })
              }
            />
          </div>

          <ProductGrid products={products} />

          <Pagination
            page={search.page}
            totalPages={totalPages}
            onPageChange={(page) =>
              navigate({ search: (prev) => ({ ...prev, page }) })
            }
          />
        </div>
      </div>
    </div>
  )
}

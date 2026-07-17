import { useMemo, useState } from 'react'
import { z } from 'zod'
import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { Package, Search } from 'lucide-react'
import {
  bulkUpdateProductStatus,
  getProductsOverview,
  listAllProducts,
} from '#/server/admin/products'
import type {
  ProductsOverview,
  ProductWithCollectionNames,
} from '#/server/admin/products'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import { DATE_RANGE_PRESETS, resolveDateRange } from '#/lib/utils/date-range'
import type { DateRangePreset } from '#/lib/utils/date-range'
import { PageHeader } from '#/components/admin/PageHeader'
import { Card } from '#/components/admin/Card'
import { StatusBadge } from '#/components/admin/Badge'
import { DateRangePicker } from '#/components/admin/DateRangePicker'
import { ProductCard } from '#/components/admin/ProductCard'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const
const PRODUCT_TYPES = [
  'tee',
  'polo',
  'hoodie',
  'jacket',
  'pants',
  'shorts',
  'accessory',
  'other',
] as const
const SORT_FIELDS = [
  'title',
  'inventory',
  'type',
  'created',
  'updated',
] as const
const SORT_LABELS: Record<(typeof SORT_FIELDS)[number], string> = {
  title: 'Product title',
  inventory: 'Inventory',
  type: 'Product type',
  created: 'Created',
  updated: 'Updated',
}

export const Route = createFileRoute('/admin/products/')({
  validateSearch: z.object({
    status: z.enum(PRODUCT_STATUSES).optional(),
    productType: z.enum(PRODUCT_TYPES).optional(),
    q: z.string().optional(),
    sort: z.enum(SORT_FIELDS).catch('created'),
    dir: z.enum(['asc', 'desc']).catch('desc'),
    range: z.enum(DATE_RANGE_PRESETS).catch('last_30_days'),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const resolved = resolveDateRange(deps.range, {
      from: deps.from,
      to: deps.to,
    })
    const [products, overview] = await Promise.all([
      listAllProducts({
        data: { status: deps.status, productType: deps.productType, q: deps.q },
      }),
      getProductsOverview({ data: resolved }),
    ])
    return { products, overview }
  },
  component: ProductsPage,
})

function ProductsPage() {
  const {
    products,
    overview,
  }: { products: ProductWithCollectionNames[]; overview: ProductsOverview } =
    Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()
  const [searchInput, setSearchInput] = useState(search.q ?? '')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkStatusError, setBulkStatusError] = useState<string | null>(null)
  const [bulkStatusSubmitting, setBulkStatusSubmitting] = useState(false)

  function toggleSelected(productId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  async function handleBulkStatus(status: 'active' | 'draft') {
    setBulkStatusSubmitting(true)
    setBulkStatusError(null)
    try {
      await bulkUpdateProductStatus({
        data: { productIds: Array.from(selected), status },
      })
      setSelected(new Set())
      await router.invalidate()
    } catch (err) {
      setBulkStatusError(getErrorMessage(err))
    } finally {
      setBulkStatusSubmitting(false)
    }
  }

  function handleRangeChange(
    preset: DateRangePreset,
    custom?: { from: string; to: string },
  ) {
    navigate({
      search: (prev) => ({
        ...prev,
        range: preset,
        from: custom?.from,
        to: custom?.to,
      }),
    })
  }

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault()
    navigate({ search: (prev) => ({ ...prev, q: searchInput || undefined }) })
  }

  const abcTotal =
    overview.abc.aRevenueCents +
    overview.abc.bRevenueCents +
    overview.abc.cRevenueCents

  const rows = useMemo(() => {
    const withComputed = products.map((product) => {
      const onHand = product.variants.reduce(
        (sum, v) =>
          sum + v.inventory.reduce((s, inv) => s + inv.quantity_on_hand, 0),
        0,
      )
      const isLowStock = product.variants.some((v) =>
        v.inventory.some(
          (inv) => inv.quantity_on_hand <= inv.low_stock_threshold,
        ),
      )
      const categories = product.collections
        .map((c) => c.collection.name)
        .join(', ')
      return { product, onHand, isLowStock, categories }
    })

    const dir = search.dir === 'asc' ? 1 : -1
    withComputed.sort((a, b) => {
      switch (search.sort) {
        case 'title':
          return dir * a.product.name.localeCompare(b.product.name)
        case 'inventory':
          return dir * (a.onHand - b.onHand)
        case 'type':
          return (
            dir * a.product.product_type.localeCompare(b.product.product_type)
          )
        case 'updated':
          return (
            dir *
            (new Date(a.product.updated_at).getTime() -
              new Date(b.product.updated_at).getTime())
          )
        case 'created':
        default:
          return (
            dir *
            (new Date(a.product.created_at).getTime() -
              new Date(b.product.created_at).getTime())
          )
      }
    })
    return withComputed
  }, [products, search.sort, search.dir])

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Products"
        subtitle={`${products.length} ${products.length === 1 ? 'product' : 'products'}`}
        action={
          <Link to="/admin/products/new" className={buttonPrimaryClassName}>
            Add product
          </Link>
        }
      />

      <Card className="mb-6 flex flex-wrap divide-x divide-neutral-200 overflow-hidden">
        <div className="flex items-center p-4">
          <DateRangePicker
            preset={search.range}
            from={overview.range.from}
            to={overview.range.to}
            onChange={handleRangeChange}
          />
        </div>
        <div className="min-w-[220px] flex-1 p-4">
          <p className="text-xs font-medium text-neutral-500">
            Average sell-through rate
          </p>
          <p className="mt-1 text-lg font-semibold text-neutral-900">
            {overview.sellThroughRate === null
              ? '—'
              : `${overview.sellThroughRate.toFixed(1)}%`}
          </p>
        </div>
        <div className="min-w-[220px] flex-1 p-4">
          <p className="text-xs font-medium text-neutral-500">
            Products with &lt;30 days of stock
          </p>
          <p className="mt-1 text-lg font-semibold text-neutral-900">
            {overview.daysOfInventory.hasVelocityData
              ? overview.daysOfInventory.lowRunwayCount
              : 'No data'}
          </p>
        </div>
        <div className="min-w-[280px] flex-1 p-4">
          <p className="text-xs font-medium text-neutral-500">
            ABC product analysis
          </p>
          {!overview.abc.hasSales ? (
            <p className="mt-1 text-lg font-semibold text-neutral-900">
              No sales yet
            </p>
          ) : (
            <p className="mt-1 text-sm font-medium text-neutral-900">
              {formatCentsAsPHP(overview.abc.aRevenueCents)}{' '}
              <span className="text-neutral-400">A</span>{' '}
              {formatCentsAsPHP(overview.abc.bRevenueCents)}{' '}
              <span className="text-neutral-400">B</span>{' '}
              {formatCentsAsPHP(overview.abc.cRevenueCents)}{' '}
              <span className="text-neutral-400">C</span>
            </p>
          )}
        </div>
      </Card>
      {abcTotal === 0 && (
        <p className="-mt-4 mb-6 text-xs text-neutral-400">
          Sell-through rate, inventory runway, and ABC analysis are computed
          from real orders and stock, for the selected period — they'll fill in
          once orders start coming through checkout.
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <form onSubmit={handleSearchSubmit} className="w-full max-w-xs">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-neutral-400"
            />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search products"
              className={`${inputClassName} w-full pl-8`}
            />
          </div>
        </form>

        <div className="flex flex-wrap gap-2">
          <Link
            to="/admin/products"
            from={Route.fullPath}
            search={(prev) => ({ ...prev, status: undefined })}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              !search.status
                ? 'bg-neutral-900 text-white'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            }`}
          >
            All
          </Link>
          {PRODUCT_STATUSES.map((s) => (
            <Link
              key={s}
              to="/admin/products"
              from={Route.fullPath}
              search={(prev) => ({ ...prev, status: s })}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
                search.status === s
                  ? 'bg-neutral-900 text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
            >
              {s}
            </Link>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={search.productType ?? ''}
          onChange={(e) =>
            navigate({
              search: (prev) => ({
                ...prev,
                productType: e.target.value
                  ? (e.target.value as (typeof PRODUCT_TYPES)[number])
                  : undefined,
              }),
            })
          }
          className={`${inputClassName} w-auto`}
        >
          <option value="">All types</option>
          {PRODUCT_TYPES.map((type) => (
            <option key={type} value={type} className="capitalize">
              {type}
            </option>
          ))}
        </select>

        <select
          value={search.sort}
          onChange={(e) =>
            navigate({
              search: (prev) => ({
                ...prev,
                sort: e.target.value as (typeof SORT_FIELDS)[number],
              }),
            })
          }
          className={`${inputClassName} w-auto`}
        >
          {SORT_FIELDS.map((field) => (
            <option key={field} value={field}>
              Sort: {SORT_LABELS[field]}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() =>
            navigate({
              search: (prev) => ({
                ...prev,
                dir: prev.dir === 'asc' ? 'desc' : 'asc',
              }),
            })
          }
          className={`${inputClassName} w-auto`}
        >
          {search.dir === 'asc' ? 'Ascending' : 'Descending'}
        </button>
      </div>

      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-neutral-200 bg-white p-3">
          <span className="text-sm font-medium text-neutral-700">
            {selected.size} selected
          </span>
          <button
            type="button"
            disabled={bulkStatusSubmitting}
            onClick={() => handleBulkStatus('active')}
            className={buttonSecondaryClassName}
          >
            Set as active
          </button>
          <button
            type="button"
            disabled={bulkStatusSubmitting}
            onClick={() => handleBulkStatus('draft')}
            className={buttonSecondaryClassName}
          >
            Set as draft
          </button>
          <Link
            to="/admin/products/bulk-edit"
            search={{ ids: Array.from(selected).join(',') }}
            className={buttonPrimaryClassName}
          >
            Bulk edit
          </Link>
          {bulkStatusError && (
            <span className="text-sm text-red-600">{bulkStatusError}</span>
          )}
        </div>
      )}

      {rows.length === 0 && (
        <p className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
          No products found.
        </p>
      )}

      {rows.length > 0 && (
        <div className="flex flex-col gap-3 md:hidden">
          {rows.map(({ product, onHand, isLowStock, categories }) => (
            <ProductCard
              key={product.id}
              product={product}
              onHand={onHand}
              isLowStock={isLowStock}
              categories={categories}
              variantCount={product.variants.length}
              checked={selected.has(product.id)}
              onToggle={() => toggleSelected(product.id)}
              onOpen={() =>
                navigate({
                  to: '/admin/products/$productId',
                  params: { productId: product.id },
                })
              }
            />
          ))}
        </div>
      )}

      <div className={`${tableWrapperClassName} hidden md:block`}>
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">No products found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClassName}>
                    <input
                      type="checkbox"
                      checked={
                        rows.length > 0 &&
                        rows.every((r) => selected.has(r.product.id))
                      }
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? new Set(rows.map((r) => r.product.id))
                            : new Set(),
                        )
                      }
                    />
                  </th>
                  <th className={tableHeadClassName}>Product</th>
                  <th className={tableHeadClassName}>Status</th>
                  <th className={tableHeadClassName}>Inventory</th>
                  <th className={tableHeadClassName}>Collections</th>
                  <th className={tableHeadClassName}>Product type</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ product, onHand, isLowStock, categories }) => {
                  return (
                    <tr key={product.id} className={tableRowClassName}>
                      <td className={tableCellClassName}>
                        <input
                          type="checkbox"
                          checked={selected.has(product.id)}
                          onChange={() => toggleSelected(product.id)}
                        />
                      </td>
                      <td className={tableCellClassName}>
                        <Link
                          to="/admin/products/$productId"
                          params={{ productId: product.id }}
                          className="flex items-center gap-3"
                        >
                          {product.images[0] ? (
                            <img
                              src={product.images[0]}
                              alt=""
                              className="size-10 rounded-md border border-neutral-200 object-cover"
                            />
                          ) : (
                            <div className="flex size-10 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50">
                              <Package size={16} className="text-neutral-300" />
                            </div>
                          )}
                          <span className="font-medium text-neutral-900 hover:underline">
                            {product.name}
                          </span>
                        </Link>
                      </td>
                      <td className={tableCellClassName}>
                        <StatusBadge status={product.status} kind="product" />
                      </td>
                      <td className={tableCellClassName}>
                        <span
                          className={
                            isLowStock ? 'font-medium text-red-600' : ''
                          }
                        >
                          {onHand} in stock
                        </span>
                        <span className="text-neutral-500">
                          {' '}
                          for {product.variants.length}{' '}
                          {product.variants.length === 1
                            ? 'variant'
                            : 'variants'}
                        </span>
                      </td>
                      <td className={`${tableCellClassName} text-neutral-500`}>
                        {categories || 'No collections'}
                      </td>
                      <td
                        className={`${tableCellClassName} text-neutral-500 capitalize`}
                      >
                        {product.product_type}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

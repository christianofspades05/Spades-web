import { useMemo, useState } from 'react'
import { z } from 'zod'
import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { Package, Search } from 'lucide-react'
import { listInventory } from '#/server/admin/inventory'
import type { InventoryRow } from '#/server/admin/inventory'
import { listAllCollections } from '#/server/admin/collections'
import type { Collection } from '#/types/entities'
import { updateVariantQuickEdit } from '#/server/admin/products'
import { getVariantsLastActivity } from '#/server/admin/last-activity'
import type { LastActivityInfo } from '#/server/admin/last-activity'
import { centsToPesos } from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import { PageHeader } from '#/components/admin/PageHeader'
import { QuantityEditor } from '#/components/admin/QuantityEditor'
import { InventoryCard } from '#/components/admin/InventoryCard'
import { LastUpdatedBadge } from '#/components/admin/LastUpdatedBadge'
import {
  buttonPrimaryClassName,
  inputClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

const SORT_FIELDS = ['sku', 'created', 'qty'] as const
const SORT_LABELS: Record<(typeof SORT_FIELDS)[number], string> = {
  sku: 'SKU',
  created: 'Date added',
  qty: 'Available qty',
}

export const Route = createFileRoute('/admin/inventory/')({
  validateSearch: z.object({
    q: z.string().optional(),
    collectionId: z.string().uuid().optional(),
    sort: z.enum(SORT_FIELDS).catch('sku'),
    dir: z.enum(['asc', 'desc']).catch('asc'),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [rows, collections] = await Promise.all([
      listInventory({ data: { q: deps.q, collectionId: deps.collectionId } }),
      listAllCollections(),
    ])
    const lastActivity = await getVariantsLastActivity({
      data: { variantIds: rows.map((r) => r.variantId) },
    })
    return { rows, collections, lastActivity }
  },
  component: InventoryPage,
})

function variantLabel(row: {
  size: string | null
  color: string | null
  style: string | null
}): string {
  return (
    [row.size, row.color, row.style].filter(Boolean).join(' / ') || 'Default'
  )
}

function InventoryPage() {
  const {
    rows,
    collections,
    lastActivity,
  }: {
    rows: InventoryRow[]
    collections: Collection[]
    lastActivity: Record<string, LastActivityInfo>
  } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [searchInput, setSearchInput] = useState(search.q ?? '')
  const router = useRouter()

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault()
    navigate({ search: (prev) => ({ ...prev, q: searchInput || undefined }) })
  }

  const sortedRows = useMemo(() => {
    const dir = search.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      switch (search.sort) {
        case 'qty':
          return dir * (a.quantityAvailable - b.quantityAvailable)
        case 'created':
          return (
            dir *
            (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
          )
        case 'sku':
        default:
          return dir * (a.sku ?? '').localeCompare(b.sku ?? '')
      }
    })
  }, [rows, search.sort, search.dir])

  const totalAvailable = rows.reduce((sum, r) => sum + r.quantityAvailable, 0)
  const lowStockCount = rows.filter(
    (r) => r.quantityAvailable <= r.lowStockThreshold,
  ).length

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Inventory"
        subtitle={`${rows.length} ${rows.length === 1 ? 'variant' : 'variants'} · ${totalAvailable} available · ${lowStockCount} low stock`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form onSubmit={handleSearchSubmit} className="w-full max-w-xs">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-neutral-400"
            />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by SKU or product"
              className={`${inputClassName} w-full pl-8`}
            />
          </div>
        </form>

        <select
          value={search.collectionId ?? ''}
          onChange={(e) =>
            navigate({
              search: (prev) => ({
                ...prev,
                collectionId: e.target.value || undefined,
              }),
            })
          }
          className={`${inputClassName} w-auto`}
        >
          <option value="">All collections</option>
          {collections.map((collection) => (
            <option key={collection.id} value={collection.id}>
              {collection.name}
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

      {sortedRows.length === 0 && (
        <p className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
          No inventory found.
        </p>
      )}

      {sortedRows.length > 0 && (
        <div className="md:hidden">
          {sortedRows.map((row) => (
            <InventoryCard
              key={row.variantId}
              row={row}
              lastActivity={lastActivity[row.variantId]}
              onSaved={() => router.invalidate()}
            />
          ))}
        </div>
      )}

      <div className={`${tableWrapperClassName} hidden md:block`}>
        {sortedRows.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">No inventory found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClassName}>Product</th>
                  <th className={tableHeadClassName}>Variant</th>
                  <th className={tableHeadClassName}>SKU</th>
                  <th className={tableHeadClassName}>Cost</th>
                  <th className={tableHeadClassName}>Available</th>
                  <th className={tableHeadClassName}>Shopee qty</th>
                  <th className={tableHeadClassName}>TikTok qty</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <InventoryTableRow
                    key={row.variantId}
                    row={row}
                    lastActivity={lastActivity[row.variantId]}
                    onSaved={() => router.invalidate()}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function InventoryTableRow({
  row,
  lastActivity,
  onSaved,
}: {
  row: InventoryRow
  lastActivity: LastActivityInfo | undefined
  onSaved: () => void
}) {
  const [sku, setSku] = useState(row.sku ?? '')
  const [costPesos, setCostPesos] = useState(
    row.costCents !== null ? centsToPesos(row.costCents) : '',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const originalCostPesos =
    row.costCents !== null ? centsToPesos(row.costCents) : ''
  const dirty = sku !== (row.sku ?? '') || costPesos !== originalCostPesos

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await updateVariantQuickEdit({
        data: {
          id: row.variantId,
          sku,
          costPesos: costPesos === '' ? undefined : Number(costPesos),
        },
      })
      onSaved()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr className={tableRowClassName}>
      <td className={tableCellClassName}>
        <Link
          to="/admin/products/$productId"
          params={{ productId: row.productId }}
          className="flex items-center gap-3"
        >
          {row.productImage ? (
            <img
              src={row.productImage}
              alt=""
              className="size-10 shrink-0 rounded-md border border-neutral-200 object-cover"
            />
          ) : (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50">
              <Package size={16} className="text-neutral-300" />
            </div>
          )}
          <span className="font-medium text-neutral-900 hover:underline">
            {row.productName}
          </span>
        </Link>
      </td>
      <td
        className={`${tableCellClassName} text-neutral-500 whitespace-nowrap`}
      >
        {variantLabel(row)}
      </td>
      <td className={tableCellClassName}>
        <input
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          className={`${inputClassName} w-48`}
        />
      </td>
      <td className={tableCellClassName}>
        <div className="flex items-center gap-1">
          <span className="text-neutral-400">₱</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={costPesos}
            onChange={(e) =>
              setCostPesos(e.target.value === '' ? '' : Number(e.target.value))
            }
            className={`${inputClassName} w-24`}
          />
          {dirty && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className={`${buttonPrimaryClassName} px-2 py-1 text-xs`}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </td>
      <td className={tableCellClassName}>
        <div className="flex items-center gap-2">
          <QuantityEditor
            variantId={row.variantId}
            availableQuantity={row.quantityAvailable}
            onSaved={onSaved}
          />
          {row.quantityAvailable <= row.lowStockThreshold && (
            <span
              title="Low stock"
              className="size-1.5 shrink-0 rounded-full bg-red-500"
            />
          )}
          <LastUpdatedBadge info={lastActivity} />
        </div>
      </td>
      <td
        className={`${tableCellClassName} text-neutral-500`}
        title="Last quantity pushed to Shopee — view only"
      >
        {row.shopeeQuantity ?? '—'}
      </td>
      <td
        className={`${tableCellClassName} text-neutral-500`}
        title="Last quantity pushed to TikTok Shop — view only"
      >
        {row.tiktokQuantity ?? '—'}
      </td>
    </tr>
  )
}

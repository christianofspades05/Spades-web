import { useState } from 'react'
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
import { updateVariantQuickEdit } from '#/server/admin/products'
import { centsToPesos } from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import { PageHeader } from '#/components/admin/PageHeader'
import { QuantityEditor } from '#/components/admin/QuantityEditor'
import {
  buttonPrimaryClassName,
  inputClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

export const Route = createFileRoute('/admin/inventory/')({
  validateSearch: z.object({ q: z.string().optional() }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => listInventory({ data: { q: deps.q } }),
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
  const rows = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [searchInput, setSearchInput] = useState(search.q ?? '')
  const router = useRouter()

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault()
    navigate({ search: { q: searchInput || undefined } })
  }

  const totalAvailable = rows.reduce((sum, r) => sum + r.quantityAvailable, 0)
  const lowStockCount = rows.filter(
    (r) => r.quantityOnHand <= r.lowStockThreshold,
  ).length

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Inventory"
        subtitle={`${rows.length} ${rows.length === 1 ? 'variant' : 'variants'} · ${totalAvailable} available · ${lowStockCount} low stock`}
      />

      <form onSubmit={handleSearchSubmit} className="mb-4 max-w-xs">
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

      <div className={tableWrapperClassName}>
        {rows.length === 0 ? (
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
                  <th className={tableHeadClassName}>On hand</th>
                  <th className={`${tableHeadClassName} text-right`}>
                    Available
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <InventoryTableRow
                    key={row.variantId}
                    row={row}
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
  onSaved,
}: {
  row: InventoryRow
  onSaved: () => void
}) {
  const [sku, setSku] = useState(row.sku)
  const [costPesos, setCostPesos] = useState(
    row.costCents !== null ? centsToPesos(row.costCents) : '',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const originalCostPesos =
    row.costCents !== null ? centsToPesos(row.costCents) : ''
  const dirty = sku !== row.sku || costPesos !== originalCostPesos

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
        </div>
      </td>
      <td className={tableCellClassName}>
        <QuantityEditor
          variantId={row.variantId}
          quantity={row.quantityOnHand}
          onSaved={onSaved}
        />
      </td>
      <td
        className={`${tableCellClassName} text-right ${
          row.quantityOnHand <= row.lowStockThreshold
            ? 'font-medium text-red-600'
            : ''
        }`}
      >
        {row.quantityAvailable}
        {dirty && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={`${buttonPrimaryClassName} ml-2 px-2 py-1 text-xs`}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </td>
    </tr>
  )
}

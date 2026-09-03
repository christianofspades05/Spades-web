import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { Package, Search } from 'lucide-react'
import {
  listPreOrderVariants,
  setPreOrderEnabled,
  adjustPreOrderQuantity,
  receivePreOrderStock,
  listOrdersWaitingOnVariant,
} from '#/server/admin/pre-orders'
import type { PreOrderVariantRow, WaitingOrderRow } from '#/server/admin/pre-orders'
import { getErrorMessage } from '#/lib/utils/errors'
import { PageHeader } from '#/components/admin/PageHeader'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

export const Route = createFileRoute('/admin/pre-orders/')({
  validateSearch: z.object({
    q: z.string().optional(),
    onlyEnabled: z.boolean().catch(false),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    listPreOrderVariants({ data: { q: deps.q, onlyEnabled: deps.onlyEnabled } }),
  component: PreOrdersPage,
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

function PreOrdersPage() {
  const rows: PreOrderVariantRow[] = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [searchInput, setSearchInput] = useState(search.q ?? '')

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault()
    navigate({ search: (prev) => ({ ...prev, q: searchInput || undefined }) })
  }

  const enabledCount = rows.filter((r) => r.isPreOrder).length

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Pre-Orders"
        subtitle="Mark variants as available for pre-order, set how many are coming, and record stock once it arrives. A pre-order can't be checked out alongside regular in-stock items, and Cash on Delivery is never available for one."
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

        <label className="flex items-center gap-2 text-sm text-neutral-600">
          <input
            type="checkbox"
            checked={search.onlyEnabled}
            onChange={(e) =>
              navigate({
                search: (prev) => ({ ...prev, onlyEnabled: e.target.checked }),
              })
            }
          />
          Pre-order enabled only ({enabledCount})
        </label>
      </div>

      <div className={tableWrapperClassName}>
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">No variants found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClassName}>Product</th>
                  <th className={tableHeadClassName}>Variant</th>
                  <th className={tableHeadClassName}>Real stock</th>
                  <th className={tableHeadClassName}>Pre-order</th>
                  <th className={tableHeadClassName}>Upcoming qty</th>
                  <th className={tableHeadClassName}>Claimed / Available</th>
                  <th className={tableHeadClassName}>Arrival note</th>
                  <th className={tableHeadClassName}>Receive stock</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <PreOrderTableRow
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

function PreOrderTableRow({
  row,
  onSaved,
}: {
  row: PreOrderVariantRow
  onSaved: () => void
}) {
  const [isPreOrder, setIsPreOrder] = useState(row.isPreOrder)
  const [arrivalNote, setArrivalNote] = useState(row.preOrderArrivalNote ?? '')
  const [quantity, setQuantity] = useState(row.preOrderQuantity)
  const [receiveQty, setReceiveQty] = useState('')
  const [showWaiting, setShowWaiting] = useState(false)
  const [waiting, setWaiting] = useState<WaitingOrderRow[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const settingsDirty =
    isPreOrder !== row.isPreOrder ||
    arrivalNote !== (row.preOrderArrivalNote ?? '')
  const quantityDirty = quantity !== row.preOrderQuantity

  async function handleSaveSettings() {
    setSaving(true)
    setError(null)
    try {
      await setPreOrderEnabled({
        data: { variantId: row.variantId, isPreOrder, arrivalNote },
      })
      onSaved()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveQuantity() {
    setSaving(true)
    setError(null)
    try {
      await adjustPreOrderQuantity({
        data: {
          variantId: row.variantId,
          quantityDelta: quantity - row.preOrderQuantity,
        },
      })
      onSaved()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleReceiveStock() {
    const qty = Number(receiveQty)
    if (!qty || qty <= 0) return
    setSaving(true)
    setError(null)
    try {
      const result = await receivePreOrderStock({
        data: { variantId: row.variantId, quantity: qty },
      })
      setReceiveQty('')
      if (result.ordersReady.length > 0) {
        setError(
          `${result.ordersReady.length} order${result.ordersReady.length > 1 ? 's are' : ' is'} now ready to fulfill.`,
        )
      }
      onSaved()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function toggleWaiting() {
    if (!showWaiting && waiting === null) {
      const rows = await listOrdersWaitingOnVariant({
        data: { variantId: row.variantId },
      })
      setWaiting(rows)
    }
    setShowWaiting((v) => !v)
  }

  return (
    <>
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
        <td className={`${tableCellClassName} text-neutral-500 whitespace-nowrap`}>
          {variantLabel(row)}
          {row.sku && <div className="text-xs text-neutral-400">{row.sku}</div>}
        </td>
        <td className={tableCellClassName}>{row.quantityOnHand}</td>
        <td className={tableCellClassName}>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isPreOrder}
              onChange={(e) => setIsPreOrder(e.target.checked)}
            />
            {settingsDirty && (
              <button
                type="button"
                onClick={handleSaveSettings}
                disabled={saving}
                className={`${buttonPrimaryClassName} px-2 py-1 text-xs`}
              >
                Save
              </button>
            )}
          </div>
        </td>
        <td className={tableCellClassName}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className={`${inputClassName} w-20`}
            />
            {quantityDirty && (
              <button
                type="button"
                onClick={handleSaveQuantity}
                disabled={saving}
                className={`${buttonPrimaryClassName} px-2 py-1 text-xs`}
              >
                Save
              </button>
            )}
          </div>
        </td>
        <td className={`${tableCellClassName} whitespace-nowrap text-neutral-500`}>
          {row.preOrderReserved} / {row.preOrderAvailable}
          {row.preOrderReserved > 0 && (
            <button
              type="button"
              onClick={toggleWaiting}
              className="ml-2 text-xs text-neutral-500 underline hover:text-neutral-900"
            >
              {showWaiting ? 'hide' : 'view waiting orders'}
            </button>
          )}
        </td>
        <td className={tableCellClassName}>
          <input
            value={arrivalNote}
            onChange={(e) => setArrivalNote(e.target.value)}
            placeholder="e.g. Expected early October"
            className={`${inputClassName} w-48`}
          />
          {settingsDirty && (
            <button
              type="button"
              onClick={handleSaveSettings}
              disabled={saving}
              className={`${buttonSecondaryClassName} mt-1 px-2 py-1 text-xs`}
            >
              Save note
            </button>
          )}
        </td>
        <td className={tableCellClassName}>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min="1"
              value={receiveQty}
              onChange={(e) => setReceiveQty(e.target.value)}
              placeholder="Qty"
              className={`${inputClassName} w-16`}
            />
            <button
              type="button"
              onClick={handleReceiveStock}
              disabled={saving || !receiveQty}
              className={`${buttonPrimaryClassName} px-2 py-1 text-xs whitespace-nowrap`}
            >
              Mark arrived
            </button>
          </div>
          {error && <p className="mt-1 max-w-[14rem] text-xs text-red-600">{error}</p>}
        </td>
      </tr>
      {showWaiting && waiting && (
        <tr>
          <td colSpan={8} className="bg-neutral-50 px-4 py-3">
            {waiting.length === 0 ? (
              <p className="text-xs text-neutral-500">No orders waiting.</p>
            ) : (
              <ul className="space-y-1 text-xs text-neutral-600">
                {waiting.map((w) => (
                  <li key={w.orderId} className="flex items-center gap-2">
                    <Link
                      to="/admin/orders/$orderId"
                      params={{ orderId: w.orderId }}
                      className="font-medium text-neutral-900 hover:underline"
                    >
                      {w.orderNumber}
                    </Link>
                    <span>
                      {new Date(w.placedAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                    <span>qty {w.quantity}</span>
                    <span
                      className={
                        w.arrived ? 'text-green-700' : 'text-amber-700'
                      }
                    >
                      {w.arrived ? 'arrived' : 'waiting'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

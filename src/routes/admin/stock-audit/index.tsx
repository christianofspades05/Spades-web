import { useMemo, useState } from 'react'
import { z } from 'zod'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { ChevronDown, ChevronLeft, ChevronRight, Package } from 'lucide-react'
import {
  listStockAuditRows,
  markVariantRecounted,
} from '#/server/admin/stock-audit'
import type { StockAuditRow } from '#/server/admin/stock-audit'
import { getErrorMessage } from '#/lib/utils/errors'
import { PageHeader } from '#/components/admin/PageHeader'
import { Badge } from '#/components/admin/Badge'
import { QuantityEditor } from '#/components/admin/QuantityEditor'
import { FilterDropdown } from '#/components/admin/FilterDropdown'
import {
  buttonSecondaryClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

const PAGE_SIZE = 50

const REASON_FILTER_OPTIONS = [
  { value: 'sold_out', label: 'Sold out recently' },
  { value: 'low_stock', label: 'Below 10 stock' },
] as const

export const Route = createFileRoute('/admin/stock-audit/')({
  // Client-side paginated (see PAGE_SIZE below) and filtered — the full
  // flagged list is already one query's worth of data, no need to
  // round-trip again just to turn a page or change the reason filter.
  validateSearch: z.object({
    page: z.number().int().min(1).catch(1),
    reason: z.enum(['sold_out', 'low_stock']).optional(),
  }),
  loader: () => listStockAuditRows(),
  component: StockAuditPage,
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

interface ProductGroup {
  productId: string
  productName: string
  productImage: string | null
  soldOutCount: number
  lowStockCount: number
  variants: StockAuditRow[]
}

function groupByProduct(rows: StockAuditRow[]): ProductGroup[] {
  const map = new Map<string, ProductGroup>()
  for (const row of rows) {
    const group = map.get(row.productId)
    if (group) {
      group.variants.push(row)
      if (row.soldOutRecently) group.soldOutCount++
      else group.lowStockCount++
    } else {
      map.set(row.productId, {
        productId: row.productId,
        productName: row.productName,
        productImage: row.productImage,
        soldOutCount: row.soldOutRecently ? 1 : 0,
        lowStockCount: row.soldOutRecently ? 0 : 1,
        variants: [row],
      })
    }
  }
  // Products with a sold-out variant surface first, matching the
  // variant-level urgency sort the server already applies.
  return Array.from(map.values()).sort((a, b) => {
    if (a.soldOutCount !== b.soldOutCount) return b.soldOutCount - a.soldOutCount
    return b.lowStockCount - a.lowStockCount
  })
}

function StockAuditPage() {
  const rows = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()

  const filteredRows = useMemo(
    () =>
      search.reason
        ? rows.filter((r) =>
            search.reason === 'sold_out' ? r.soldOutRecently : !r.soldOutRecently,
          )
        : rows,
    [rows, search.reason],
  )
  const groups = useMemo(() => groupByProduct(filteredRows), [filteredRows])

  const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE))
  const page = Math.min(search.page, totalPages)
  const pageGroups = groups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Stock Audit"
        subtitle={
          rows.length === 0
            ? 'Nothing needs a recount right now.'
            : `${groups.length} ${groups.length === 1 ? 'product' : 'products'} · ${filteredRows.length} ${filteredRows.length === 1 ? 'variant needs' : 'variants need'} a physical recount`
        }
      />

      {rows.length > 0 && (
        <div className="mb-4">
          <FilterDropdown
            label="Reason"
            value={search.reason}
            options={REASON_FILTER_OPTIONS}
            onChange={(reason) =>
              navigate({ search: (prev) => ({ ...prev, reason, page: 1 }) })
            }
          />
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
          Every active product is either well-stocked or already confirmed at
          its current count.
        </p>
      ) : groups.length === 0 ? (
        <p className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
          No products match this filter.
        </p>
      ) : (
        <>
          <div className={`${tableWrapperClassName} overflow-x-auto`}>
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClassName}>Product</th>
                  <th className={tableHeadClassName}>Flagged sizes</th>
                  <th className={tableHeadClassName}></th>
                </tr>
              </thead>
              <tbody>
                {pageGroups.map((group) => (
                  <ProductGroupRows
                    key={group.productId}
                    group={group}
                    onRecounted={() => router.invalidate()}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-neutral-500">
              <p>
                Showing {(page - 1) * PAGE_SIZE + 1}–
                {Math.min(page * PAGE_SIZE, groups.length)} of {groups.length}{' '}
                products
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() =>
                    navigate({ search: (prev) => ({ ...prev, page: page - 1 }) })
                  }
                  className={`${buttonSecondaryClassName} inline-flex items-center gap-1 ${page <= 1 ? 'pointer-events-none opacity-40' : ''}`}
                >
                  <ChevronLeft size={14} />
                  Previous
                </button>
                <span className="text-xs text-neutral-400">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() =>
                    navigate({ search: (prev) => ({ ...prev, page: page + 1 }) })
                  }
                  className={`${buttonSecondaryClassName} inline-flex items-center gap-1 ${page >= totalPages ? 'pointer-events-none opacity-40' : ''}`}
                >
                  Next
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ProductGroupRows({
  group,
  onRecounted,
}: {
  group: ProductGroup
  onRecounted: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <tr
        className={`${tableRowClassName} cursor-pointer`}
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="max-w-[110px] px-2 py-1.5 sm:max-w-[180px] sm:px-4 sm:py-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            {group.productImage ? (
              <img
                src={group.productImage}
                alt=""
                className="size-7 shrink-0 rounded-md border border-neutral-200 object-cover sm:size-10"
              />
            ) : (
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 sm:size-10">
                <Package size={16} className="text-neutral-300" />
              </div>
            )}
            <span className="min-w-0 break-words text-[9px] font-medium leading-tight text-neutral-900 sm:text-sm">
              {group.productName}
            </span>
          </div>
        </td>
        <td className="px-2 py-1.5 sm:px-4 sm:py-3">
          <div className="flex flex-wrap gap-1 [&>span]:text-[9px] sm:gap-1.5 sm:[&>span]:text-xs">
            {group.soldOutCount > 0 && (
              <Badge tone="critical">{group.soldOutCount} sold out</Badge>
            )}
            {group.lowStockCount > 0 && (
              <Badge tone="warning">{group.lowStockCount} low stock</Badge>
            )}
          </div>
        </td>
        <td className="px-2 py-1.5 text-right sm:px-4 sm:py-3">
          <ChevronDown
            size={16}
            className={`inline-block text-neutral-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </td>
      </tr>

      {expanded &&
        group.variants.map((row) => (
          <StockAuditVariantRow
            key={row.variantId}
            row={row}
            onRecounted={onRecounted}
          />
        ))}
    </>
  )
}

function StockAuditVariantRow({
  row,
  onRecounted,
}: {
  row: StockAuditRow
  onRecounted: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRecount() {
    setSaving(true)
    setError(null)
    try {
      await markVariantRecounted({ data: { variantId: row.variantId } })
      onRecounted()
    } catch (err) {
      setError(getErrorMessage(err))
      setSaving(false)
    }
  }

  // Deliberately not reusing tableCellClassName here — these sub-rows need
  // to be noticeably more compact than the rest of the admin's tables on
  // small screens (smaller padding/text, tighter indent), while staying at
  // the normal size from sm: up.
  const cellClassName =
    'px-2 py-1.5 text-[9px] text-neutral-900 sm:px-4 sm:py-3 sm:text-sm'

  return (
    <tr className={`${tableRowClassName} bg-neutral-50`}>
      <td className={`${cellClassName} pl-8 sm:pl-14`}>
        <Link
          to="/admin/products/$productId"
          params={{ productId: row.productId }}
          className="font-medium text-neutral-700 hover:underline"
        >
          {variantLabel(row)}
        </Link>
        {row.sku && (
          <span className="ml-2 text-neutral-400">{row.sku}</span>
        )}
      </td>
      <td className={cellClassName}>
        <div className="flex flex-wrap items-center gap-1.5 [&>span]:text-[9px] sm:gap-2 sm:[&>span]:text-xs">
          <span
            className={
              row.quantityAvailable === 0
                ? 'font-semibold text-red-600'
                : 'font-medium text-amber-600'
            }
          >
            {row.quantityAvailable} available
          </span>
          {row.soldOutRecently ? (
            <Badge tone="critical">
              <span className="sm:hidden">Sold out</span>
              <span className="hidden sm:inline">Sold out — recent sales</span>
            </Badge>
          ) : (
            <Badge tone="warning">Low stock</Badge>
          )}
        </div>
        <div className="mt-1">
          <QuantityEditor
            variantId={row.variantId}
            availableQuantity={row.quantityAvailable}
            onSaved={onRecounted}
            variant="pill"
          />
        </div>
        {row.previousRecountAt && (
          <p className="mt-1 text-[9px] text-neutral-400 sm:text-xs">
            Changed since last recount (
            {new Date(row.previousRecountAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })}
            )
          </p>
        )}
      </td>
      <td className={`${cellClassName} text-right`}>
        <button
          type="button"
          onClick={handleRecount}
          disabled={saving}
          className={`${buttonSecondaryClassName} !px-2 !py-1 !text-[9px] sm:!px-3.5 sm:!py-2 sm:!text-sm`}
        >
          {saving ? (
            'Saving…'
          ) : (
            <>
              <span className="sm:hidden">Recounted</span>
              <span className="hidden sm:inline">Mark recounted</span>
            </>
          )}
        </button>
        {error && <p className="mt-1 text-[9px] text-red-600 sm:text-xs">{error}</p>}
      </td>
    </tr>
  )
}

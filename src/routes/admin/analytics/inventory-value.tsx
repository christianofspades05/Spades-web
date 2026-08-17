import { useState } from 'react'
import { z } from 'zod'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Package } from 'lucide-react'
import { getInventoryValueReport } from '#/server/admin/analytics'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { Card } from '#/components/admin/Card'
import { PageHeader } from '#/components/admin/PageHeader'
import {
  inputClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'
import {
  STOREFRONT_BRAND_LABELS,
  STOREFRONT_BRANDS,
} from '#/lib/validation/admin/storefront-sections'

export const Route = createFileRoute('/admin/analytics/inventory-value')({
  validateSearch: z.object({
    brand: z.enum(STOREFRONT_BRANDS).optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    getInventoryValueReport({ data: { brand: deps.brand } }),
  component: InventoryValuePage,
})

function ProductThumbnail({ imageUrl }: { imageUrl: string | null }) {
  return imageUrl ? (
    <img
      src={imageUrl}
      alt=""
      className="size-9 rounded-md border border-neutral-200 object-cover"
    />
  ) : (
    <div className="flex size-9 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50">
      <Package size={14} className="text-neutral-300" />
    </div>
  )
}

function InventoryValuePage() {
  const report = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [showMissingCostOnly, setShowMissingCostOnly] = useState(false)

  const visibleRows = showMissingCostOnly
    ? report.rows.filter((r) => r.hasMissingCost)
    : report.rows

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Inventory Value"
        subtitle="Total value of your physical stock on hand, by product."
        action={
          <select
            value={search.brand ?? ''}
            onChange={(e) =>
              navigate({
                search: (prev) => ({
                  ...prev,
                  brand: (e.target.value || undefined) as
                    (typeof STOREFRONT_BRANDS)[number] | undefined,
                }),
              })
            }
            className={inputClassName}
          >
            <option value="">All Brands</option>
            {STOREFRONT_BRANDS.map((b) => (
              <option key={b} value={b}>
                {STOREFRONT_BRAND_LABELS[b]}
              </option>
            ))}
          </select>
        }
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm font-medium text-neutral-500">Units on hand</p>
          <p className="mt-2 text-3xl font-semibold text-neutral-900">
            {report.totalUnits.toLocaleString()}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-neutral-500">
            Inventory value
          </p>
          <p className="mt-2 text-3xl font-semibold text-neutral-900">
            {formatCentsAsPHP(report.totalInventoryValueCents)}
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            At cost — what this stock cost you
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-neutral-500">Retail value</p>
          <p className="mt-2 text-3xl font-semibold text-neutral-900">
            {formatCentsAsPHP(report.totalRetailValueCents)}
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            At full price — what it'd sell for
          </p>
        </Card>
      </div>

      {report.productsMissingCost > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>
            {report.productsMissingCost}{' '}
            {report.productsMissingCost === 1 ? 'product has' : 'products have'}{' '}
            at least one variant with no cost price set — inventory value is
            understated for those. Set a cost on the product's variants to fix
            this.
          </span>
          <button
            type="button"
            onClick={() => setShowMissingCostOnly((v) => !v)}
            className="shrink-0 font-medium underline decoration-amber-400 underline-offset-2 hover:text-amber-950"
          >
            {showMissingCostOnly
              ? 'Show all products'
              : `View ${report.productsMissingCost === 1 ? 'this product' : 'these products'}`}
          </button>
        </div>
      )}

      <Card className="mt-4 p-5">
        {visibleRows.length > 0 ? (
          <div className={`${tableWrapperClassName} overflow-x-auto`}>
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClassName}>Product</th>
                  <th className={`${tableHeadClassName} text-right`}>Qty</th>
                  <th className={`${tableHeadClassName} text-right`}>
                    Inventory value
                  </th>
                  <th className={`${tableHeadClassName} text-right`}>
                    Retail value
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.productId} className={tableRowClassName}>
                    <td className={`${tableCellClassName} font-medium`}>
                      <div className="flex items-center gap-3">
                        <ProductThumbnail imageUrl={row.productImage} />
                        {row.productName}
                        {row.hasMissingCost && (
                          <span
                            title="At least one variant has no cost price set"
                            className="text-xs font-normal text-amber-600"
                          >
                            *
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={`${tableCellClassName} text-right`}>
                      {row.quantityOnHand.toLocaleString()}
                    </td>
                    <td className={`${tableCellClassName} text-right`}>
                      {formatCentsAsPHP(row.inventoryValueCents)}
                    </td>
                    <td className={`${tableCellClassName} text-right`}>
                      {formatCentsAsPHP(row.retailValueCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-neutral-400">
            {showMissingCostOnly
              ? 'No products with stock are missing a cost price.'
              : 'No stock on hand.'}
          </p>
        )}
      </Card>
    </div>
  )
}

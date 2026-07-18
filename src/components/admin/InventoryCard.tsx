import { Package } from 'lucide-react'
import { QuantityEditor } from '#/components/admin/QuantityEditor'
import type { InventoryRow } from '#/server/admin/inventory'

/** Mobile row rendering of an inventory-list item — a compact list row (photo, title, variant, SKU, quantity pill), matching Shopify's mobile Inventory list density rather than a padded card. Kept out of inventory/index.tsx to avoid adding to that file's route-type-checking surface (see OrderCard.tsx for the same reasoning). */
export function InventoryCard({
  row,
  onSaved,
}: {
  row: InventoryRow
  onSaved: () => void
}) {
  const isLowStock = row.quantityOnHand <= row.lowStockThreshold
  const variantLabel = [row.size, row.color, row.style]
    .filter(Boolean)
    .join(' / ')

  return (
    <div className="flex items-center gap-3 border-b border-neutral-100 py-3 first:pt-0 last:border-b-0">
      {row.productImage ? (
        <img
          src={row.productImage}
          alt=""
          className="size-11 shrink-0 rounded-md border border-neutral-200 object-cover"
        />
      ) : (
        <div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50">
          <Package size={16} className="text-neutral-300" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-medium text-neutral-900">
          {row.productName}
          {isLowStock && (
            <span
              title="Low stock"
              className="size-1.5 shrink-0 rounded-full bg-red-500"
            />
          )}
        </p>
        {variantLabel && (
          <p className="text-sm text-neutral-500">{variantLabel}</p>
        )}
        <p className="text-xs text-neutral-400">SKU: {row.sku}</p>
      </div>

      <QuantityEditor
        variant="pill"
        variantId={row.variantId}
        quantity={row.quantityOnHand}
        onSaved={onSaved}
      />
    </div>
  )
}

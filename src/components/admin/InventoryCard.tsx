import { Package } from 'lucide-react'
import { Card } from '#/components/admin/Card'
import { QuantityEditor } from '#/components/admin/QuantityEditor'
import type { InventoryRow } from '#/server/admin/inventory'

function variantLabel(row: {
  size: string | null
  color: string | null
  style: string | null
}): string {
  return (
    [row.size, row.color, row.style].filter(Boolean).join(' / ') || 'Default'
  )
}

/** Mobile card rendering of an inventory-list row — just enough to glance at and adjust stock on a phone (product photo, title, variant, quantity), the same minimal shape as Shopify's mobile inventory view. Kept out of inventory/index.tsx to avoid adding to that file's route-type-checking surface (see OrderCard.tsx for the same reasoning). */
export function InventoryCard({
  row,
  onSaved,
}: {
  row: InventoryRow
  onSaved: () => void
}) {
  const isLowStock = row.quantityOnHand <= row.lowStockThreshold

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        {row.productImage ? (
          <img
            src={row.productImage}
            alt=""
            className="size-11 shrink-0 rounded-md border border-neutral-200 object-cover"
          />
        ) : (
          <div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50">
            <Package size={18} className="text-neutral-300" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-neutral-900">
            {row.productName}
          </p>
          <p className="truncate text-xs text-neutral-500">
            {variantLabel(row)} · {row.sku}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span
          className={`text-xs ${isLowStock ? 'font-medium text-red-600' : 'text-neutral-500'}`}
        >
          {row.quantityAvailable} available
        </span>
        <QuantityEditor
          variantId={row.variantId}
          quantity={row.quantityOnHand}
          onSaved={onSaved}
        />
      </div>
    </Card>
  )
}

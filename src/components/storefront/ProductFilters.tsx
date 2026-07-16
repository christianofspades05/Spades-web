import { useEffect, useState } from 'react'
import { useDebouncedValue } from '#/lib/hooks/useDebouncedValue'
import {
  PRODUCT_TYPES,
  PRODUCT_TYPE_LABELS,
} from '#/lib/validation/product-listing'
import type { ProductType } from '#/lib/validation/product-listing'
import { inputClassName, labelClassName } from './ui'

interface ProductFiltersProps {
  type: ProductType | undefined
  minPrice: number | undefined
  maxPrice: number | undefined
  inStock: boolean | undefined
  onTypeChange: (type: ProductType | undefined) => void
  onPriceChange: (min: number | undefined, max: number | undefined) => void
  onInStockChange: (inStock: boolean | undefined) => void
}

export function ProductFilters({
  type,
  minPrice,
  maxPrice,
  inStock,
  onTypeChange,
  onPriceChange,
  onInStockChange,
}: ProductFiltersProps) {
  const [minText, setMinText] = useState(minPrice?.toString() ?? '')
  const [maxText, setMaxText] = useState(maxPrice?.toString() ?? '')
  const debouncedMin = useDebouncedValue(minText, 400)
  const debouncedMax = useDebouncedValue(maxText, 400)

  useEffect(() => {
    const min = debouncedMin.trim() === '' ? undefined : Number(debouncedMin)
    const max = debouncedMax.trim() === '' ? undefined : Number(debouncedMax)
    onPriceChange(
      min !== undefined && !Number.isNaN(min) ? min : undefined,
      max !== undefined && !Number.isNaN(max) ? max : undefined,
    )
    // Fire only when the debounced text settles.
  }, [debouncedMin, debouncedMax])

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Category
        </p>
        <select
          value={type ?? ''}
          onChange={(e) =>
            onTypeChange(
              e.target.value ? (e.target.value as ProductType) : undefined,
            )
          }
          className={`${inputClassName} w-full`}
        >
          <option value="">All categories</option>
          {PRODUCT_TYPES.map((t) => (
            <option key={t} value={t}>
              {PRODUCT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Price (PHP)
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="Min"
            value={minText}
            onChange={(e) => setMinText(e.target.value)}
            className={`${inputClassName} w-full`}
          />
          <span className="text-neutral-400">–</span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="Max"
            value={maxText}
            onChange={(e) => setMaxText(e.target.value)}
            className={`${inputClassName} w-full`}
          />
        </div>
      </div>

      <label className={`${labelClassName} flex-row items-center gap-2`}>
        <input
          type="checkbox"
          checked={inStock ?? false}
          onChange={(e) => onInStockChange(e.target.checked ? true : undefined)}
          className="h-4 w-4 rounded border-neutral-300"
        />
        In stock only
      </label>
    </div>
  )
}

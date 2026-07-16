import { SORT_LABELS, SORT_OPTIONS } from '#/lib/validation/product-listing'
import type { ProductListingSort } from '#/lib/validation/product-listing'
import { inputClassName } from './ui'

interface SortSelectProps {
  value: ProductListingSort
  onChange: (sort: ProductListingSort) => void
}

export function SortSelect({ value, onChange }: SortSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ProductListingSort)}
      className={inputClassName}
    >
      {SORT_OPTIONS.map((option) => (
        <option key={option} value={option}>
          {SORT_LABELS[option]}
        </option>
      ))}
    </select>
  )
}

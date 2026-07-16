import { useEffect, useMemo, useState } from 'react'
import { cn } from '#/lib/utils/cn'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { compareSizes, formatSizeLabel } from '#/lib/utils/size-order'
import type { ProductVariant } from '#/types/entities'

export type VariantWithStock = ProductVariant & {
  inventory: { quantity_available: number }[]
}

const DIMENSIONS = ['size', 'color', 'style'] as const
type Dimension = (typeof DIMENSIONS)[number]

function stockOf(variant: VariantWithStock): number {
  return variant.inventory.reduce((sum, inv) => sum + inv.quantity_available, 0)
}

interface VariantSelectorProps {
  variants: VariantWithStock[]
  onVariantChange: (variant: VariantWithStock | undefined) => void
}

export function VariantSelector({
  variants,
  onVariantChange,
}: VariantSelectorProps) {
  const activeVariants = useMemo(
    () => variants.filter((v) => v.is_active),
    [variants],
  )

  const optionsByDimension = useMemo(() => {
    const options: Partial<Record<Dimension, string[]>> = {}
    for (const dim of DIMENSIONS) {
      const values = Array.from(
        new Set(
          activeVariants
            .map((v) => v[dim])
            .filter((v): v is string => Boolean(v)),
        ),
      )
      if (dim === 'size') values.sort(compareSizes)
      if (values.length > 0) options[dim] = values
    }
    return options
  }, [activeVariants])

  const [selected, setSelected] = useState<Partial<Record<Dimension, string>>>(
    () => {
      if (activeVariants.length === 1) {
        const only = activeVariants[0]
        return {
          ...(only.size ? { size: only.size } : {}),
          ...(only.color ? { color: only.color } : {}),
          ...(only.style ? { style: only.style } : {}),
        }
      }
      return {}
    },
  )

  const dimensions = Object.keys(optionsByDimension) as Dimension[]
  const allSelected = dimensions.every((dim) => selected[dim])

  const resolvedVariant = allSelected
    ? activeVariants.find((v) =>
        dimensions.every((dim) => v[dim] === selected[dim]),
      )
    : undefined

  useEffect(() => {
    onVariantChange(resolvedVariant)
  }, [resolvedVariant?.id])

  function isValueInStock(dim: Dimension, value: string): boolean {
    return activeVariants.some(
      (v) =>
        v[dim] === value &&
        dimensions.every(
          (d) => d === dim || !selected[d] || v[d] === selected[d],
        ) &&
        stockOf(v) > 0,
    )
  }

  return (
    <div className="space-y-5">
      {dimensions.map((dim) => (
        <div key={dim}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {dim}
          </p>
          <div className="flex flex-wrap gap-2">
            {optionsByDimension[dim]!.map((value) => {
              const isSelected = selected[dim] === value
              const inStock = isValueInStock(dim, value)
              return (
                <button
                  key={value}
                  type="button"
                  disabled={!inStock}
                  onClick={() =>
                    setSelected((prev) => ({ ...prev, [dim]: value }))
                  }
                  className={cn(
                    'rounded-full border px-4 py-1.5 text-sm font-medium transition',
                    isSelected
                      ? 'border-neutral-950 bg-neutral-950 text-white dark:border-white dark:bg-white dark:text-neutral-950'
                      : 'border-neutral-300 text-neutral-700 hover:border-neutral-900 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-white',
                    !inStock &&
                      'cursor-not-allowed border-neutral-200 text-neutral-300 line-through hover:border-neutral-200 dark:border-neutral-800 dark:text-neutral-700 dark:hover:border-neutral-800',
                  )}
                >
                  {dim === 'size' ? formatSizeLabel(value) : value}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {resolvedVariant && (
        <p className="text-2xl font-semibold text-neutral-900 dark:text-white">
          {formatCentsAsPHP(resolvedVariant.price_cents)}
          {resolvedVariant.compare_at_price_cents != null &&
            resolvedVariant.compare_at_price_cents >
              resolvedVariant.price_cents && (
              <span className="ml-2 text-base font-normal text-neutral-400 line-through dark:text-neutral-600">
                {formatCentsAsPHP(resolvedVariant.compare_at_price_cents)}
              </span>
            )}
        </p>
      )}
    </div>
  )
}

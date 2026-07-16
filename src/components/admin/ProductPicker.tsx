import { useState } from 'react'
import { Package, Search, X } from 'lucide-react'
import { searchProductsForPicker } from '#/server/admin/products'
import type { ProductPickerResult } from '#/server/admin/products'
import { Card } from '#/components/admin/Card'
import { buttonSecondaryClassName, inputClassName } from '#/components/admin/ui'

export interface PickedProduct {
  id: string
  name: string
  image: string | null
}

export function ProductPicker({
  selected,
  onAdd,
  onRemove,
}: {
  selected: PickedProduct[]
  onAdd: (product: ProductPickerResult) => void
  onRemove: (productId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductPickerResult[]>([])
  const [loading, setLoading] = useState(false)
  const selectedIds = new Set(selected.map((p) => p.id))

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    try {
      const found = await searchProductsForPicker({
        data: { q: query || undefined },
      })
      setResults(found.filter((p) => !selectedIds.has(p.id)))
    } finally {
      setLoading(false)
    }
  }

  function handleAdd(product: ProductPickerResult) {
    onAdd(product)
    setResults((prev) => prev.filter((p) => p.id !== product.id))
  }

  return (
    <div className="flex flex-col gap-3">
      {selected.length > 0 && (
        <Card className="p-2">
          <ul>
            {selected.map((product) => (
              <li
                key={product.id}
                className="flex items-center gap-3 border-b border-neutral-100 px-2 py-2 last:border-b-0"
              >
                {product.image ? (
                  <img
                    src={product.image}
                    alt=""
                    className="size-9 rounded-md border border-neutral-200 object-cover"
                  />
                ) : (
                  <div className="flex size-9 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50">
                    <Package size={14} className="text-neutral-300" />
                  </div>
                )}
                <span className="flex-1 text-sm font-medium text-neutral-900">
                  {product.name}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(product.id)}
                  className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <form onSubmit={handleSearch} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-neutral-400"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products to add"
            className={`${inputClassName} w-full pl-8`}
          />
        </div>
        <button type="submit" className={buttonSecondaryClassName}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {results.length > 0 && (
        <Card className="p-2">
          <ul>
            {results.map((product) => (
              <li
                key={product.id}
                className="flex items-center gap-3 border-b border-neutral-100 px-2 py-2 last:border-b-0"
              >
                {product.image ? (
                  <img
                    src={product.image}
                    alt=""
                    className="size-9 rounded-md border border-neutral-200 object-cover"
                  />
                ) : (
                  <div className="flex size-9 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50">
                    <Package size={14} className="text-neutral-300" />
                  </div>
                )}
                <span className="flex-1 text-sm font-medium text-neutral-900">
                  {product.name}
                </span>
                <button
                  type="button"
                  onClick={() => handleAdd(product)}
                  className={`${buttonSecondaryClassName} px-2 py-1 text-xs`}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

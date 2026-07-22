import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Search, X } from 'lucide-react'
import { useDebouncedValue } from '#/lib/hooks/useDebouncedValue'
import { quickSearchProducts } from '#/server/products/queries'
import type {
  StorefrontListingProduct,
  WithSalePrice,
} from '#/server/products/queries'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { inputClassName } from './ui'

/**
 * In-place search — clicking the header's search icon opens this over the
 * current page (see Header.tsx) instead of navigating to /products, so a
 * shopper can search without losing whatever page they were on.
 */
export function SearchOverlay({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 300)
  const [results, setResults] = useState<
    (StorefrontListingProduct & WithSalePrice)[]
  >([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fresh every time it's opened, rather than showing whatever was left
  // over from the last time it was closed.
  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      // Autofocus needs a tick — the input isn't in the DOM yet on the
      // same render that flips `open` to true.
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const trimmed = debouncedQuery.trim()
    if (!trimmed) {
      setResults([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    quickSearchProducts({ data: { q: trimmed } })
      .then((products) => {
        if (!cancelled) setResults(products)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, open])

  useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  const trimmedQuery = query.trim()

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative mx-auto mt-20 w-full max-w-lg px-4">
        <div className="rounded-xl bg-white shadow-xl dark:bg-neutral-950">
          <div className="flex items-center gap-3 border-b border-neutral-200 p-4 dark:border-neutral-800">
            <Search className="h-4 w-4 shrink-0 text-neutral-400" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products..."
              className={`${inputClassName} flex-1 border-none p-0 shadow-none focus:ring-0`}
            />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close search"
              className="shrink-0 text-neutral-400 hover:text-neutral-950 dark:hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {trimmedQuery && (
            <div className="max-h-[60vh] overflow-y-auto">
              {loading && results.length === 0 && (
                <p className="p-4 text-sm text-neutral-500 dark:text-neutral-400">
                  Searching…
                </p>
              )}
              {!loading && results.length === 0 && (
                <p className="p-4 text-sm text-neutral-500 dark:text-neutral-400">
                  No products found for "{trimmedQuery}".
                </p>
              )}
              {results.map((product) => {
                const onSale =
                  product.salePriceCents != null &&
                  product.salePriceCents < product.min_price_cents
                return (
                  <Link
                    key={product.id}
                    to="/products/$slug"
                    params={{ slug: product.slug }}
                    onClick={onClose}
                    className="flex items-center gap-3 p-3 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  >
                    {product.images[0] ? (
                      <img
                        src={product.images[0]}
                        alt=""
                        className="size-12 shrink-0 rounded-md bg-neutral-100 object-contain dark:bg-neutral-900"
                      />
                    ) : (
                      <div className="size-12 shrink-0 rounded-md bg-neutral-100 dark:bg-neutral-900" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-neutral-900 dark:text-white">
                        {product.name}
                      </p>
                      {onSale ? (
                        <p className="flex items-center gap-1.5 text-xs">
                          <span className="text-red-600 dark:text-red-400">
                            {formatCentsAsPHP(product.salePriceCents!)}
                          </span>
                          <span className="text-neutral-400 line-through dark:text-neutral-600">
                            {formatCentsAsPHP(product.min_price_cents)}
                          </span>
                        </p>
                      ) : (
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">
                          {formatCentsAsPHP(product.min_price_cents)}
                        </p>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          )}

          {trimmedQuery && (
            <Link
              to="/products"
              search={{ q: trimmedQuery, sort: 'newest', page: 1 }}
              onClick={onClose}
              className="block border-t border-neutral-200 p-3 text-center text-sm font-medium text-neutral-600 hover:text-neutral-950 dark:border-neutral-800 dark:text-neutral-400 dark:hover:text-white"
            >
              See all results for "{trimmedQuery}"
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

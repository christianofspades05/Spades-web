import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  SUPPORTED_CURRENCIES,
  useCurrency,
} from '#/lib/currency/CurrencyContext'

export function CurrencySelector() {
  const { currency, setCurrency } = useCurrency()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Select currency"
        aria-expanded={open}
        className="flex items-center gap-0.5 rounded-md p-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {currency}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-28 overflow-hidden rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-950">
          {SUPPORTED_CURRENCIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setCurrency(c)
                setOpen(false)
              }}
              className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                c === currency
                  ? 'font-semibold text-neutral-950 dark:text-white'
                  : 'text-neutral-600 dark:text-neutral-400'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

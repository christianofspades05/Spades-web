import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

/** A single-select, click-to-open filter control — same interaction pattern as DateRangePicker, generalized for any list of string options. */
export function FilterDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  /** Shown on the button when nothing is selected, and as the "clear" row's title. */
  label: string
  /** Loosely typed to `string` (rather than `T`) so callers can pass a broader URL-search-param type — e.g. an order status enum wider than this particular dropdown's option list — without a cast. */
  value: string | undefined
  options: readonly { value: T; label: string }[]
  onChange: (value: T | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const selectedLabel = options.find((o) => o.value === value)?.label

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
          value
            ? 'bg-neutral-900 text-white'
            : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
        }`}
      >
        {selectedLabel ?? label}
        <ChevronDown
          size={13}
          className={value ? 'text-neutral-300' : 'text-neutral-400'}
        />
      </button>

      {open && (
        <div className="absolute left-0 z-20 mt-1.5 w-56 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              onChange(undefined)
              setOpen(false)
            }}
            className={`w-full rounded-md px-3 py-1.5 text-left text-sm ${
              !value
                ? 'bg-neutral-100 font-medium text-neutral-900'
                : 'text-neutral-700 hover:bg-neutral-50'
            }`}
          >
            All {label}
          </button>
          <div className="my-1 border-t border-neutral-100" />
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={`w-full rounded-md px-3 py-1.5 text-left text-sm ${
                value === o.value
                  ? 'bg-neutral-100 font-medium text-neutral-900'
                  : 'text-neutral-700 hover:bg-neutral-50'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

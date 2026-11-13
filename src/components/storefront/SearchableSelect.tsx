import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { inputClassName } from '#/components/storefront/ui'
import { normalizeSearchText } from '#/lib/utils/search-text'

export interface SearchableSelectOption {
  value: string
  label: string
}

/**
 * A dropdown that looks and behaves like the plain <select> it replaces —
 * tap it, pick from the list — but opens with a search box at the top of
 * that list, so a city with 100+ barangays can be narrowed by typing a few
 * letters instead of scrolling. Matching ignores case, accents and
 * punctuation ("las pinas" finds Las Piñas).
 *
 * Keeps native form validation working through a visually hidden required
 * input mirroring the selected value.
 */
export function SearchableSelect({
  label,
  value,
  options,
  placeholder,
  searchPlaceholder,
  disabled,
  required,
  onChange,
}: {
  label: string
  value: string
  options: readonly SearchableSelectOption[]
  placeholder: string
  searchPlaceholder: string
  disabled?: boolean
  required?: boolean
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const labelId = useId()
  const listboxId = useId()

  const filtered = useMemo(() => {
    const q = normalizeSearchText(query)
    if (!q) return options
    const words = q.split(' ')
    const matches = options.filter((o) => {
      const text = normalizeSearchText(o.label)
      return words.every((w) => text.includes(w))
    })
    // Names that start with what was typed first, then the rest.
    return [
      ...matches.filter((o) => normalizeSearchText(o.label).startsWith(q)),
      ...matches.filter((o) => !normalizeSearchText(o.label).startsWith(q)),
    ]
  }, [options, query])

  const selectedLabel = options.find((o) => o.value === value)?.label

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    function handleOutside(event: MouseEvent | TouchEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${highlighted}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlighted, open])

  function openList() {
    if (disabled) return
    setQuery('')
    const selectedIndex = options.findIndex((o) => o.value === value)
    setHighlighted(Math.max(selectedIndex, 0))
    setOpen(true)
  }

  function choose(option: SearchableSelectOption) {
    onChange(option.value)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1">
      <span
        id={labelId}
        className="text-sm font-medium text-neutral-700 dark:text-neutral-300"
      >
        {label}
      </span>
      <button
        type="button"
        role="combobox"
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        className={`${inputClassName} flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <span
          className={
            selectedLabel ? undefined : 'text-neutral-500 dark:text-neutral-400'
          }
        >
          {selectedLabel ?? placeholder}
        </span>
        <ChevronDown size={16} className="shrink-0 text-neutral-400" />
      </button>
      {required && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          required
          value={value}
          onChange={() => {}}
          className="pointer-events-none absolute bottom-0 left-4 h-px w-px opacity-0"
        />
      )}

      {open && (
        <div className="absolute top-full z-30 mt-1 w-full rounded-md border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <div className="border-b border-neutral-200 p-2 dark:border-neutral-700">
            <input
              ref={searchRef}
              type="search"
              autoComplete="off"
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              aria-controls={listboxId}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setHighlighted(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setHighlighted((h) => Math.min(h + 1, filtered.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setHighlighted((h) => Math.max(h - 1, 0))
                } else if (e.key === 'Enter') {
                  // Pick, don't submit the checkout form.
                  e.preventDefault()
                  const option = filtered.at(highlighted) ?? filtered.at(0)
                  if (option) choose(option)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setOpen(false)
                }
              }}
              className={`${inputClassName} w-full`}
            />
          </div>
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-labelledby={labelId}
            className="max-h-64 overflow-auto py-1 text-sm"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-neutral-500 dark:text-neutral-400">
                No matches
              </li>
            ) : (
              filtered.map((option, i) => (
                <li
                  key={option.value}
                  data-index={i}
                  role="option"
                  aria-selected={option.value === value}
                  onMouseDown={(e) => {
                    // Before the outside-click handler closes the list.
                    e.preventDefault()
                    choose(option)
                  }}
                  onMouseEnter={() => setHighlighted(i)}
                  className={`cursor-pointer px-3 py-2 ${
                    i === highlighted
                      ? 'bg-neutral-100 dark:bg-neutral-800'
                      : ''
                  } ${option.value === value ? 'font-semibold' : ''}`}
                >
                  {option.label}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

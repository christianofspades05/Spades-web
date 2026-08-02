import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { formatCountryName } from '#/lib/utils/countries'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import { inputClassName } from '#/components/storefront/ui'

/** Searchable country picker for checkout — a plain <select> with ~200
 *  options meant scrolling through the whole alphabet to find one country,
 *  so this swaps in a filterable list instead (same open/close-on-outside-
 *  click pattern as admin's FilterDropdown). `countryCodes` is PH plus
 *  whatever countries have an active market (see admin/markets) — orders
 *  only ship where the owner has actually configured pricing/shipping for,
 *  so the full ~200-country list was never a real option to begin with. */
export function CountrySelect({
  value,
  onChange,
  countryCodes,
}: {
  value: string
  onChange: (code: string) => void
  countryCodes: string[]
}) {
  const { t } = useLanguage()
  const allCountries = useMemo(
    () => countryCodes.map((code) => ({ code, name: formatCountryName(code) })),
    [countryCodes],
  )
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

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

  useEffect(() => {
    if (open) {
      setQuery('')
      searchInputRef.current?.focus()
    }
  }, [open])

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (!trimmed) return allCountries
    return allCountries.filter((c) => c.name.toLowerCase().includes(trimmed))
  }, [query, allCountries])

  const selectedName =
    allCountries.find((c) => c.code === value)?.name ??
    t.countrySelect.selectCountry

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${inputClassName} flex w-full items-center justify-between text-left`}
      >
        <span>{selectedName}</span>
        <ChevronDown size={16} className="text-neutral-400" />
      </button>

      {open && (
        <div className="absolute left-0 z-20 mt-1 w-full rounded-md border border-neutral-300 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <div className="relative border-b border-neutral-200 p-2 dark:border-neutral-800">
            <Search
              size={15}
              className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-neutral-400"
            />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.countrySelect.searchCountry}
              className={`${inputClassName} w-full pl-8`}
            />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-neutral-400">
                {t.countrySelect.noCountriesFound}
              </li>
            )}
            {filtered.map((c) => (
              <li key={c.code}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(c.code)
                    setOpen(false)
                  }}
                  className={`w-full px-3 py-1.5 text-left text-sm ${
                    c.code === value
                      ? 'bg-neutral-100 font-medium text-neutral-950 dark:bg-neutral-800 dark:text-white'
                      : 'text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800'
                  }`}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

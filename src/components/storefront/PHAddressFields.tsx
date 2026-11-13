import { useEffect, useId, useMemo, useState } from 'react'
import { inputClassName, labelClassName } from '#/components/storefront/ui'
import { formatRegionLabel } from '#/lib/utils/ph-region'
import {
  buildAddressSearchIndex,
  searchAddresses,
} from '#/lib/checkout/ph-address-search'
import type { PHAddressSearchEntry } from '#/lib/checkout/ph-address-search'

/**
 * region -> province -> city/municipality -> barangay[]. NCR (and any
 * region with no province layer) uses the empty string as its single
 * "province" key, so consumers should treat `province === ''` as "this
 * region has no province step" rather than a real selection.
 *
 * Source: PSGC (Philippine Standard Geographic Code), Philippine Statistics
 * Authority, via https://github.com/xemasiv/psgc2 (CC-BY-4.0).
 */
type PHAddressData = Partial<
  Record<string, Partial<Record<string, Partial<Record<string, string[]>>>>>
>

let cachedIndex: PHAddressSearchEntry[] | null = null
function getSearchIndex(data: PHAddressData): PHAddressSearchEntry[] {
  cachedIndex ??= buildAddressSearchIndex(data)
  return cachedIndex
}

function selectionLabel(value: PHAddressValue): string {
  const province =
    value.province ||
    (value.region === 'NATIONAL CAPITAL REGION (NCR)' ? 'Metro Manila' : '')
  return [value.barangay, value.city, province].filter(Boolean).join(', ')
}

export interface PHAddressValue {
  region: string
  province: string
  city: string
  barangay: string
}

interface PHAddressFieldsProps {
  value: PHAddressValue
  onChange: (value: PHAddressValue) => void
}

let cachedData: PHAddressData | null = null
let cachedDataPromise: Promise<PHAddressData> | null = null

function loadAddressData(): Promise<PHAddressData> {
  if (cachedData) return Promise.resolve(cachedData)
  cachedDataPromise ??= fetch('/data/ph-address.json')
    .then((res) => res.json())
    .then((data: PHAddressData) => {
      cachedData = data
      return data
    })
  return cachedDataPromise
}

/**
 * One "Type your barangay or city" search field by default — picking a
 * result fills region/province/city/barangay together. The original four
 * cascading dropdowns are still here behind "Choose from lists instead",
 * for anyone whose barangay isn't found by name (or who prefers them).
 */
export function PHAddressFields({ value, onChange }: PHAddressFieldsProps) {
  const [data, setData] = useState<PHAddressData | null>(cachedData)
  const [mode, setMode] = useState<'search' | 'lists'>('search')
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const [open, setOpen] = useState(false)
  const listboxId = useId()
  const index = useMemo(() => (data ? getSearchIndex(data) : null), [data])
  const results = useMemo(
    () => (index ? searchAddresses(index, query) : []),
    [index, query],
  )

  useEffect(() => {
    let cancelled = false
    if (!data) {
      loadAddressData().then((loaded) => {
        if (!cancelled) setData(loaded)
      })
    }
    return () => {
      cancelled = true
    }
  }, [data])

  if (!data) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Loading address fields...
      </p>
    )
  }

  function pick(entry: PHAddressSearchEntry) {
    onChange({
      region: entry.region,
      province: entry.province,
      city: entry.city,
      barangay: entry.barangay,
    })
    setQuery('')
    setOpen(false)
  }

  if (mode === 'search') {
    const hasCity = Boolean(value.region && value.city)
    const barangaysForPickedCity = hasCity
      ? (data[value.region]?.[value.province]?.[value.city] ?? [])
      : []
    return (
      <div className="space-y-3">
        {hasCity ? (
          <div className="flex items-start justify-between gap-3 rounded-md border border-neutral-300 px-3 py-2.5 text-sm dark:border-neutral-700">
            <div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Barangay / City
              </p>
              <p className="font-medium text-neutral-900 dark:text-white">
                {selectionLabel(value)}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                onChange({ region: '', province: '', city: '', barangay: '' })
              }
              className="shrink-0 text-sm text-neutral-600 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="relative">
            <label className={labelClassName}>
              Barangay / City
              <input
                type="text"
                role="combobox"
                aria-expanded={open && results.length > 0}
                aria-controls={listboxId}
                aria-autocomplete="list"
                autoComplete="off"
                placeholder="Type your barangay or city"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setHighlighted(0)
                  setOpen(true)
                }}
                onFocus={() => setOpen(true)}
                // Delay so a tap on a result lands before the list closes.
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                onKeyDown={(e) => {
                  if (!results.length) return
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setHighlighted((h) => Math.min(h + 1, results.length - 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setHighlighted((h) => Math.max(h - 1, 0))
                  } else if (e.key === 'Enter') {
                    // Enter picks the highlighted result instead of
                    // submitting the whole checkout form.
                    e.preventDefault()
                    pick(results[highlighted] ?? results[0])
                  }
                }}
                className={inputClassName}
              />
            </label>
            {open && results.length > 0 && (
              <ul
                id={listboxId}
                role="listbox"
                className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
              >
                {results.map((entry, i) => (
                  <li
                    key={`${entry.region}|${entry.province}|${entry.city}|${entry.barangay}`}
                    role="option"
                    aria-selected={i === highlighted}
                  >
                    <button
                      type="button"
                      // onMouseDown, not onClick, so it fires before the
                      // input's blur closes the list.
                      onMouseDown={(e) => {
                        e.preventDefault()
                        pick(entry)
                      }}
                      onMouseEnter={() => setHighlighted(i)}
                      className={`block w-full px-3 py-2 text-left ${
                        i === highlighted
                          ? 'bg-neutral-100 dark:bg-neutral-800'
                          : ''
                      }`}
                    >
                      {entry.label}
                      {entry.barangay === '' && (
                        <span className="ml-1 text-xs text-neutral-500 dark:text-neutral-400">
                          (city)
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {open && query.trim().length >= 2 && results.length === 0 && (
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                No match — check the spelling, or choose from the lists below.
              </p>
            )}
          </div>
        )}

        {/* A city-level pick still needs its barangay. */}
        {hasCity && !value.barangay && (
          <label className={labelClassName}>
            Barangay
            <select
              required
              value={value.barangay}
              onChange={(e) => onChange({ ...value, barangay: e.target.value })}
              className={inputClassName}
            >
              <option value="" disabled>
                Select barangay
              </option>
              {barangaysForPickedCity.map((barangay) => (
                <option key={barangay} value={barangay}>
                  {barangay}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          onClick={() => setMode('lists')}
          className="text-xs text-neutral-500 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
        >
          Choose from lists instead
        </button>
      </div>
    )
  }

  const regions = Object.keys(data)
  const provincesForRegion = value.region
    ? Object.keys(data[value.region] ?? {})
    : []
  const hasProvinceStep = !(
    provincesForRegion.length === 1 && provincesForRegion[0] === ''
  )
  const effectiveProvince = hasProvinceStep ? value.province : ''
  const citiesForProvince = value.region
    ? Object.keys(data[value.region]?.[effectiveProvince] ?? {})
    : []
  const barangaysForCity =
    value.region && value.city
      ? (data[value.region]?.[effectiveProvince]?.[value.city] ?? [])
      : []

  function handleRegionChange(region: string) {
    onChange({ region, province: '', city: '', barangay: '' })
  }

  function handleProvinceChange(province: string) {
    onChange({ ...value, province, city: '', barangay: '' })
  }

  function handleCityChange(city: string) {
    onChange({ ...value, city, barangay: '' })
  }

  function handleBarangayChange(barangay: string) {
    onChange({ ...value, barangay })
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClassName}>
          Region
          <select
            required
            value={value.region}
            onChange={(e) => handleRegionChange(e.target.value)}
            className={inputClassName}
          >
            <option value="" disabled>
              Select region
            </option>
            {regions.map((region) => (
              <option key={region} value={region}>
                {formatRegionLabel(region)}
              </option>
            ))}
          </select>
        </label>

        {hasProvinceStep && (
          <label className={labelClassName}>
            Province
            <select
              required
              value={value.province}
              onChange={(e) => handleProvinceChange(e.target.value)}
              disabled={!value.region}
              className={inputClassName}
            >
              <option value="" disabled>
                Select province
              </option>
              {provincesForRegion.map((province) => (
                <option key={province} value={province}>
                  {province}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className={labelClassName}>
          City / Municipality
          <select
            required
            value={value.city}
            onChange={(e) => handleCityChange(e.target.value)}
            disabled={!value.region || (hasProvinceStep && !value.province)}
            className={inputClassName}
          >
            <option value="" disabled>
              Select city / municipality
            </option>
            {citiesForProvince.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </label>

        <label className={labelClassName}>
          Barangay
          <select
            required
            value={value.barangay}
            onChange={(e) => handleBarangayChange(e.target.value)}
            disabled={!value.city}
            className={inputClassName}
          >
            <option value="" disabled>
              Select barangay
            </option>
            {barangaysForCity.map((barangay) => (
              <option key={barangay} value={barangay}>
                {barangay}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        type="button"
        onClick={() => setMode('search')}
        className="text-xs text-neutral-500 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
      >
        Search by barangay or city instead
      </button>
    </div>
  )
}

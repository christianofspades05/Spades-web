import { useEffect, useState } from 'react'
import { formatRegionLabel } from '#/lib/utils/ph-region'
import { SearchableSelect } from '#/components/storefront/SearchableSelect'

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

export function PHAddressFields({ value, onChange }: PHAddressFieldsProps) {
  const [data, setData] = useState<PHAddressData | null>(cachedData)

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

  // Each level is a dropdown with a search box at the top of its list —
  // same Region -> Province -> City -> Barangay order as before, just
  // filterable by typing (a city can have 100+ barangays).
  const toOptions = (values: string[]) =>
    values.map((v) => ({ value: v, label: v }))

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <SearchableSelect
        label="Region"
        required
        value={value.region}
        options={regions.map((region) => ({
          value: region,
          label: formatRegionLabel(region),
        }))}
        placeholder="Select region"
        searchPlaceholder="Search region"
        onChange={handleRegionChange}
      />

      {hasProvinceStep && (
        <SearchableSelect
          label="Province"
          required
          value={value.province}
          options={toOptions(provincesForRegion)}
          placeholder="Select province"
          searchPlaceholder="Search province"
          disabled={!value.region}
          onChange={handleProvinceChange}
        />
      )}

      <SearchableSelect
        label="City / Municipality"
        required
        value={value.city}
        options={toOptions(citiesForProvince)}
        placeholder="Select city / municipality"
        searchPlaceholder="Search city / municipality"
        disabled={!value.region || (hasProvinceStep && !value.province)}
        onChange={handleCityChange}
      />

      <SearchableSelect
        label="Barangay"
        required
        value={value.barangay}
        options={toOptions(barangaysForCity)}
        placeholder="Select barangay"
        searchPlaceholder="Search barangay"
        disabled={!value.city}
        onChange={handleBarangayChange}
      />
    </div>
  )
}

import { useEffect, useState } from 'react'
import { inputClassName, labelClassName } from '#/components/storefront/ui'
import { formatRegionLabel } from '#/lib/utils/ph-region'

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

  return (
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
  )
}

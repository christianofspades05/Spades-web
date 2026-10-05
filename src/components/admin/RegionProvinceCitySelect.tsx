import { useEffect, useState } from 'react'
import { inputClassName, labelClassName } from '#/components/admin/ui'
import { formatRegionLabel } from '#/lib/utils/ph-region'

/**
 * Region -> province -> city/municipality picker, no barangay step — same
 * PSGC dataset as storefront/PHAddressFields.tsx (checkout's address form),
 * reused here (not imported directly — that component is storefront-only
 * and always requires a barangay) so the values this produces are
 * guaranteed to match exactly what a real checkout address stores.
 */
type PHAddressData = Partial<
  Record<string, Partial<Record<string, Partial<Record<string, string[]>>>>>
>

export interface RegionProvinceCityValue {
  region: string
  province: string
  city: string
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

export function RegionProvinceCitySelect({
  value,
  onChange,
}: {
  value: RegionProvinceCityValue
  onChange: (value: RegionProvinceCityValue) => void
}) {
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
      <p className="text-sm text-neutral-500">Loading address data...</p>
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

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <label className={labelClassName}>
        Region
        <select
          required
          value={value.region}
          onChange={(e) =>
            onChange({ region: e.target.value, province: '', city: '' })
          }
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
            onChange={(e) =>
              onChange({ ...value, province: e.target.value, city: '' })
            }
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
          onChange={(e) => onChange({ ...value, city: e.target.value })}
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
    </div>
  )
}

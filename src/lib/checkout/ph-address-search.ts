/**
 * Type-ahead search over the PSGC address tree (public/data/ph-address.json:
 * region -> province -> city/municipality -> barangay[]), powering the
 * checkout's single "Type your barangay or city" field. Picking a result
 * fills region, province, city and (for a barangay result) barangay in one
 * go, instead of four dependent dropdowns.
 *
 * ~42k barangays + ~1.6k cities: building the index is a one-off pass after
 * the JSON loads, and each search is a linear scan with cheap substring
 * checks — well under a few ms per keystroke on a phone.
 */
import { NCR_REGION_KEY } from '#/lib/utils/ph-region'

export type PHAddressData = Partial<
  Record<string, Partial<Record<string, Partial<Record<string, string[]>>>>>
>

export interface PHAddressSearchEntry {
  region: string
  /** '' for NCR, which has no province layer in the PSGC data. */
  province: string
  city: string
  /** '' for a city-level entry (shopper still picks the barangay). */
  barangay: string
  /** What the shopper sees, e.g. "Bagumbayan, Quezon City, Metro Manila". */
  label: string
  /** Normalised forms used for matching and ranking. */
  normBarangay: string
  normCity: string
  normAll: string
}

/** Lower-case, accent-free, punctuation-free, single-spaced — so "Las Piñas",
 *  "las pinas" and "LAS PIÑAS" all match, and "(Pob.)" / "City Of" noise
 *  doesn't get in the way. */
export function normalizeAddressText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(pob\.?\)/g, ' poblacion ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** "City Of Manila" reads better as "Manila City"-ish for display, but the
 *  stored value must stay the dataset's own string — only the label changes. */
function cityLabel(city: string): string {
  return city.replace(/^City Of (.+)$/i, '$1 City')
}

function provinceLabel(region: string, province: string): string {
  if (province) return province
  return region === NCR_REGION_KEY ? 'Metro Manila' : ''
}

export function buildAddressSearchIndex(
  data: PHAddressData,
): PHAddressSearchEntry[] {
  const entries: PHAddressSearchEntry[] = []
  for (const [region, provinces] of Object.entries(data)) {
    if (!provinces) continue
    for (const [province, cities] of Object.entries(provinces)) {
      if (!cities) continue
      const provLabel = provinceLabel(region, province)
      for (const [city, barangays] of Object.entries(cities)) {
        const cLabel = cityLabel(city)
        const normCity = normalizeAddressText(city)
        const cityTail = [cLabel, provLabel].filter(Boolean).join(', ')
        entries.push({
          region,
          province,
          city,
          barangay: '',
          label: cityTail,
          normBarangay: '',
          normCity,
          normAll: normalizeAddressText(`${city} ${provLabel}`),
        })
        for (const barangay of barangays ?? []) {
          entries.push({
            region,
            province,
            city,
            barangay,
            label: `${barangay}, ${cityTail}`,
            normBarangay: normalizeAddressText(barangay),
            normCity,
            normAll: normalizeAddressText(`${barangay} ${city} ${provLabel}`),
          })
        }
      }
    }
  }
  return entries
}

/** Lower is better. */
function rank(entry: PHAddressSearchEntry, query: string): number {
  const isCity = entry.barangay === ''
  if (isCity && entry.normCity === query) return 0
  if (!isCity && entry.normBarangay === query) return 1
  if (isCity && entry.normCity.startsWith(query)) return 2
  if (!isCity && entry.normBarangay.startsWith(query)) return 3
  if (isCity) return 4
  return 5
}

/**
 * Every query word must appear somewhere in the entry (barangay, city or
 * province), so "bagumbayan quezon" narrows to that one barangay. Results
 * are ranked exact > prefix > anywhere, cities before barangays at each
 * level, then alphabetically.
 */
export function searchAddresses(
  index: readonly PHAddressSearchEntry[],
  rawQuery: string,
  limit = 8,
): PHAddressSearchEntry[] {
  const query = normalizeAddressText(rawQuery)
  if (query.length < 2) return []
  const words = query.split(' ')
  const matches: { entry: PHAddressSearchEntry; score: number }[] = []
  for (const entry of index) {
    if (words.every((w) => entry.normAll.includes(w))) {
      matches.push({ entry, score: rank(entry, query) })
    }
  }
  matches.sort(
    (a, b) => a.score - b.score || a.entry.label.localeCompare(b.entry.label),
  )
  return matches.slice(0, limit).map((m) => m.entry)
}

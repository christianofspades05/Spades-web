import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildAddressSearchIndex,
  normalizeAddressText,
  searchAddresses,
} from './ph-address-search'
import type { PHAddressData } from './ph-address-search'

// The real PSGC file the storefront serves — so these assertions break if
// the dataset's naming ever shifts under the search.
const data = JSON.parse(
  readFileSync('public/data/ph-address.json', 'utf8'),
) as PHAddressData
const index = buildAddressSearchIndex(data)

describe('normalizeAddressText', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalizeAddressText('LAS PIÑAS')).toBe('las pinas')
    expect(normalizeAddressText('Calaylayan (Pob.)')).toBe(
      'calaylayan poblacion',
    )
  })
})

describe('searchAddresses', () => {
  it('indexes every barangay plus each city', () => {
    expect(index.length).toBeGreaterThan(42_000)
  })

  it('puts the city itself first for a city name', () => {
    const [first] = searchAddresses(index, 'quezon city')
    expect(first.barangay).toBe('')
    expect(first.city.toLowerCase()).toContain('quezon')
    expect(first.label).toContain('Metro Manila')
  })

  it('finds a barangay by name and fills every level', () => {
    const results = searchAddresses(index, 'bagumbayan quezon')
    const hit = results.find((r) => r.barangay === 'Bagumbayan')
    expect(hit).toBeDefined()
    expect(hit?.region).toBe('NATIONAL CAPITAL REGION (NCR)')
    expect(hit?.province).toBe('')
    expect(hit?.city.toLowerCase()).toContain('quezon')
  })

  it('matches without the ñ', () => {
    const results = searchAddresses(index, 'las pinas')
    expect(results.some((r) => r.city.includes('Las Piñas'))).toBe(true)
  })

  it('finds provincial municipalities with their province', () => {
    const [first] = searchAddresses(index, 'abucay')
    expect(first.province).toBe('Bataan')
    expect(first.label).toBe('Abucay, Bataan')
  })

  it('returns nothing for under 2 characters and caps results', () => {
    expect(searchAddresses(index, 'a')).toEqual([])
    expect(searchAddresses(index, 'san').length).toBe(8)
  })
})

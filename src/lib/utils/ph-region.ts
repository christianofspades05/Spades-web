/**
 * The PSGC dataset (public/data/ph-address.json) stores region names in
 * ALL CAPS, e.g. "NATIONAL CAPITAL REGION (NCR)" — correct as a lookup key,
 * but not how anyone wants to read it. This reformats a raw region string
 * into standard title case for display, while leaving genuine acronyms
 * (NCR, CAR, BARMM, CALABARZON, MIMAROPA, SOCCSKSARGEN) and roman numerals
 * upper-cased. The raw string itself must still be used as the <select>
 * value / stored value — only the visible label should go through this.
 */
const ACRONYM_WORDS = new Set([
  'NCR',
  'CAR',
  'BARMM',
  'MIMAROPA',
  'CALABARZON',
  'SOCCSKSARGEN',
])

const ROMAN_NUMERALS = new Set([
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
  'XIII',
])

function titleCaseWord(word: string): string {
  if (word.length === 0) return word
  const upper = word.toUpperCase()
  if (ACRONYM_WORDS.has(upper)) return upper
  if (word.includes('-')) return word.split('-').map(titleCaseWord).join('-')
  if (ROMAN_NUMERALS.has(upper)) return upper
  return upper[0] + word.slice(1).toLowerCase()
}

function titleCasePhrase(phrase: string): string {
  return phrase.split(' ').map(titleCaseWord).join(' ')
}

export function formatRegionLabel(region: string): string {
  const match = /^(.*?)\s*\(([^)]+)\)$/.exec(region)
  if (!match) return titleCasePhrase(region)
  const [, main, inner] = match
  return `${titleCasePhrase(main)} (${titleCasePhrase(inner)})`
}

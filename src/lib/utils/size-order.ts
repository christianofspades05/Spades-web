/**
 * Clothing sizes are stored as free-form text (product_variants.size has no
 * enum/check constraint), so real data ends up mixed: "m"/"M", "xl"/"XL",
 * "2xl"/"XXL", "3xl"/"XXL" style notations all exist side by side. This
 * ranks any of those spellings into the same canonical S/M/L/XL/2XL/3XL
 * order without renaming the label shown to staff/customers.
 */
const BASE_SIZE_RANK: Record<string, number> = {
  XXS: -2,
  XS: -1,
  S: 1,
  M: 2,
  L: 3,
}

function sizeRank(rawSize: string): number | null {
  const size = rawSize.trim().toUpperCase()
  if (size in BASE_SIZE_RANK) return BASE_SIZE_RANK[size]
  if (size === 'XL') return 4

  // "2XL", "3XL", "4XL", ...
  const digitMatch = size.match(/^(\d+)XL$/)
  if (digitMatch) return 3 + Number(digitMatch[1])

  // "XXL", "XXXL", "XXXXL", ... (2+ repeated X's before the L)
  const xMatch = size.match(/^(X+)L$/)
  if (xMatch && xMatch[1].length >= 2) return 3 + xMatch[1].length

  return null
}

/** Sorts known sizes into S/M/L/XL/2XL/... order; unrecognized sizes (waist numbers, "One Size", etc.) sort after, alphabetically. */
export function compareSizes(a: string, b: string): number {
  const rankA = sizeRank(a)
  const rankB = sizeRank(b)
  if (rankA !== null && rankB !== null) return rankA - rankB
  if (rankA !== null) return -1
  if (rankB !== null) return 1
  return a.localeCompare(b)
}

export function formatSizeLabel(size: string): string {
  return size.trim().toUpperCase()
}

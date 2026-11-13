/**
 * Lower-case, accent-free, punctuation-free, single-spaced text for
 * type-to-filter lists (e.g. the checkout's searchable address dropdowns) —
 * so "Las Piñas", "las pinas" and "LAS PIÑAS" all match, and "(Pob.)"
 * matches "poblacion".
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(pob\.?\)/g, ' poblacion ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

import type { RenderedStorefrontSection } from '#/server/storefront/sections'

function isVisibleProductGrid(section: RenderedStorefrontSection): boolean {
  return (
    section.type === 'product_grid' &&
    section.collectionSlug !== '' &&
    section.products.length > 0
  )
}

/**
 * Where the Community Fits block goes in the homepage's section list: right
 * before the "New Release" product grid (matched by title, since homepage
 * sections are staff-configured rows). If that section is ever renamed or
 * removed, falls back to before the first visible product grid, and
 * finally to the end of the page. Returns an index in [0, sections.length].
 */
export function communityFitsInsertIndex(
  sections: RenderedStorefrontSection[],
): number {
  const newRelease = sections.findIndex(
    (s) =>
      isVisibleProductGrid(s) &&
      (s.title ?? '').trim().toLowerCase().replace(/\s+/g, ' ') ===
        'new release',
  )
  if (newRelease >= 0) return newRelease
  const firstGrid = sections.findIndex(isVisibleProductGrid)
  return firstGrid >= 0 ? firstGrid : sections.length
}

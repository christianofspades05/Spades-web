import type { RenderedStorefrontSection } from '#/server/storefront/sections'

/**
 * Where the homepage "Community Events" block goes: right after the "Official Web
 * Store" tagline (the first tagline section), so it sits above the first
 * product grid. Falls back to before the first product grid, then to the
 * end of the page. Returns an index in [0, sections.length] — the block is
 * rendered just before the section at that index.
 */
export function eventsInsertIndex(
  sections: RenderedStorefrontSection[],
): number {
  const tagline = sections.findIndex((s) => s.type === 'tagline')
  if (tagline >= 0) return tagline + 1
  const firstGrid = sections.findIndex((s) => s.type === 'product_grid')
  return firstGrid >= 0 ? firstGrid : sections.length
}

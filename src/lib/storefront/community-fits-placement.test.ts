import { describe, expect, it } from 'vitest'
import type { RenderedStorefrontSection } from '#/server/storefront/sections'
import { communityFitsInsertIndex } from './community-fits-placement'

function grid(title: string, productCount = 1): RenderedStorefrontSection {
  return {
    type: 'product_grid',
    id: title,
    title,
    titleJa: null,
    titleKo: null,
    titleZh: null,
    linkUrl: null,
    collectionSlug: 'c',
    products: Array.from({ length: productCount }, () => ({})) as never,
  }
}

const video = {
  type: 'video',
  id: 'v',
  title: null,
} as RenderedStorefrontSection

describe('communityFitsInsertIndex', () => {
  it('goes right before the New Release grid', () => {
    expect(
      communityFitsInsertIndex([
        video,
        grid('Sale'),
        grid('New Release'),
        grid('Best Sellers'),
      ]),
    ).toBe(2)
    expect(communityFitsInsertIndex([video, grid('  NEW   RELEASE ')])).toBe(1)
  })

  it('skips an empty New Release grid and falls back to the first visible grid', () => {
    expect(
      communityFitsInsertIndex([video, grid('New Release', 0), grid('Tees')]),
    ).toBe(2)
  })

  it('falls back to the end when there are no product grids', () => {
    expect(communityFitsInsertIndex([video])).toBe(1)
    expect(communityFitsInsertIndex([])).toBe(0)
  })
})

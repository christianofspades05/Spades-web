import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CollectionListingScope, CollectionMetadata } from './queries'

const { mockGetCache } = vi.hoisted(() => ({ mockGetCache: vi.fn() }))

vi.mock('@vercel/functions', () => ({
  getCache: mockGetCache,
}))

/** Real Map-backed fake, not a bare stub — a key-construction bug (two
 *  different slugs colliding on the same cache key, or a leaked tag)
 *  surfaces as a wrong cached value, the way it would against real Runtime
 *  Cache. Same style as scoped-products.test.ts's createRealisticFakeCache. */
function createRealisticFakeCache() {
  const store = new Map<string, unknown>()
  const tagsByKey = new Map<string, string[]>()
  return {
    store,
    tagsByKey,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown, options?: { tags?: string[] }) => {
      store.set(key, value)
      tagsByKey.set(key, options?.tags ?? [])
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
      tagsByKey.delete(key)
    }),
    expireTag: vi.fn(async (tags: string | string[]) => {
      const tagList = Array.isArray(tags) ? tags : [tags]
      for (const [key, keyTags] of tagsByKey) {
        if (keyTags.some((t) => tagList.includes(t))) store.delete(key)
      }
    }),
  }
}

type FakeCollectionRow = CollectionMetadata

/** Minimal fake of the RLS-scoped Supabase client's chained query builder —
 *  just enough surface for fetchCollectionListingScope to run against fixed
 *  fixture data, mirroring scoped-products.test.ts's fakeAdmin. */
function fakeSupabase(fixture: {
  collectionsBySlug: Record<string, FakeCollectionRow | undefined>
  membershipsByCollectionId: Record<
    string,
    { product_id: string; sort_order: number }[]
  >
}) {
  return {
    from(table: string) {
      if (table === 'collections') {
        return {
          select: () => ({
            eq: (_col1: string, slug: string) => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: fixture.collectionsBySlug[slug] ?? null,
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'product_collections') {
        return {
          select: () => ({
            eq: (_col: string, collectionId: string) => ({
              order: () => ({
                overrideTypes: async () => ({
                  data: fixture.membershipsByCollectionId[collectionId] ?? [],
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table in fake supabase: ${table}`)
    },
  }
}

async function freshModule() {
  vi.resetModules()
  return import('./queries')
}

describe('isCollectionListingScope', () => {
  it('accepts a scope with a collection and memberships', async () => {
    const { isCollectionListingScope } = await freshModule()
    expect(
      isCollectionListingScope({
        collection: { id: 'c1', brand: 'spades' },
        memberships: [],
      }),
    ).toBe(true)
  })

  it('accepts a scope with a null collection (slug not found)', async () => {
    const { isCollectionListingScope } = await freshModule()
    expect(isCollectionListingScope({ collection: null, memberships: [] })).toBe(true)
  })

  it('rejects a missing memberships array', async () => {
    const { isCollectionListingScope } = await freshModule()
    expect(isCollectionListingScope({ collection: null })).toBe(false)
  })

  it('rejects null, undefined, and non-object values', async () => {
    const { isCollectionListingScope } = await freshModule()
    expect(isCollectionListingScope(null)).toBe(false)
    expect(isCollectionListingScope(undefined)).toBe(false)
    expect(isCollectionListingScope('garbage')).toBe(false)
  })
})

describe('collectionListingScopeTags', () => {
  it('tags with collection:<id> when a collection is present', async () => {
    const { collectionListingScopeTags } = await freshModule()
    const scope: CollectionListingScope = {
      collection: { id: 'abc-123' } as CollectionMetadata,
      memberships: [],
    }
    expect(collectionListingScopeTags(scope)).toEqual(['collection:abc-123'])
  })

  it('returns no tags when the collection is null', async () => {
    const { collectionListingScopeTags } = await freshModule()
    expect(collectionListingScopeTags({ collection: null, memberships: [] })).toEqual([])
  })
})

describe('fetchCollectionListingScope', () => {
  it('returns the collection and its memberships for a known slug', async () => {
    const { fetchCollectionListingScope } = await freshModule()
    const supabase = fakeSupabase({
      collectionsBySlug: {
        'clearance-sale': {
          id: 'col-1',
          brand: 'spades',
          match_type: 'all',
          rules: [],
          sort_by: 'created_desc',
          hide_out_of_stock_products: false,
          max_products: null,
        },
      },
      membershipsByCollectionId: {
        'col-1': [{ product_id: 'p1', sort_order: 0 }],
      },
    })

    const result = await fetchCollectionListingScope(supabase as never, 'clearance-sale')

    expect(result.collection?.id).toBe('col-1')
    expect(result.memberships).toEqual([{ product_id: 'p1', sort_order: 0 }])
  })

  it('returns a null collection and empty memberships for an unknown slug', async () => {
    const { fetchCollectionListingScope } = await freshModule()
    const supabase = fakeSupabase({ collectionsBySlug: {}, membershipsByCollectionId: {} })

    const result = await fetchCollectionListingScope(supabase as never, 'does-not-exist')

    expect(result).toEqual({ collection: null, memberships: [] })
  })
})

describe('getCollectionListingScope — shared cache wiring', () => {
  beforeEach(() => {
    mockGetCache.mockReset()
  })

  it('1. cold slug: queries the DB once and stores the result, tagged by collection id', async () => {
    const { getCollectionListingScope } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const supabase = fakeSupabase({
      collectionsBySlug: {
        'new-release': {
          id: 'col-new-release',
          brand: 'spades',
          match_type: 'all',
          rules: [],
          sort_by: 'created_desc',
          hide_out_of_stock_products: false,
          max_products: null,
        },
      },
      membershipsByCollectionId: { 'col-new-release': [] },
    })

    const result = await getCollectionListingScope(supabase as never, 'new-release')

    expect(result.collection?.id).toBe('col-new-release')
    expect(cache.get).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledTimes(1)
    expect(cache.tagsByKey.get('new-release')).toEqual(['collection:col-new-release'])
  })

  it('2. warm slug: a second call for the same slug is served from Runtime Cache, no second DB query', async () => {
    const { getCollectionListingScope } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    let dbQueryCount = 0
    const supabase = fakeSupabase({
      collectionsBySlug: {
        'best-sellers': {
          id: 'col-best',
          brand: 'spades',
          match_type: 'all',
          rules: [],
          sort_by: 'created_desc',
          hide_out_of_stock_products: false,
          max_products: null,
        },
      },
      membershipsByCollectionId: { 'col-best': [{ product_id: 'p1', sort_order: 0 }] },
    })
    const countingSupabase = {
      from(table: string) {
        if (table === 'collections') dbQueryCount++
        return supabase.from(table)
      },
    }

    const first = await getCollectionListingScope(countingSupabase as never, 'best-sellers')
    const second = await getCollectionListingScope(countingSupabase as never, 'best-sellers')

    expect(second).toEqual(first)
    expect(dbQueryCount).toBe(1) // second call never reached the DB
    expect(cache.get).toHaveBeenCalledTimes(2)
    expect(cache.set).toHaveBeenCalledTimes(1) // only the first (cold) call wrote
  })

  it('3. concurrent calls for the same slug collapse into one DB query (single-flight)', async () => {
    const { getCollectionListingScope } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    let queryCount = 0
    const supabase = {
      from(table: string) {
        if (table === 'collections') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => {
                    queryCount++
                    await new Promise((r) => setTimeout(r, 5))
                    return {
                      data: {
                        id: 'col-graphic-tees',
                        brand: 'spades',
                        match_type: 'all',
                        rules: [],
                        sort_by: 'created_desc',
                        hide_out_of_stock_products: false,
                        max_products: null,
                      },
                    }
                  },
                }),
              }),
            }),
          }
        }
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                overrideTypes: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        }
      },
    }

    const results = await Promise.all(
      Array.from({ length: 13 }, () =>
        getCollectionListingScope(supabase as never, 'graphic-tees'),
      ),
    )

    expect(queryCount).toBe(1)
    expect(results.every((r) => r.collection?.id === 'col-graphic-tees')).toBe(true)
  })

  it('4. different slugs get independent cache entries, no cross-collection leakage', async () => {
    const { getCollectionListingScope } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const supabase = fakeSupabase({
      collectionsBySlug: {
        'clearance-sale': {
          id: 'col-clearance',
          brand: 'spades',
          match_type: 'all',
          rules: [],
          sort_by: 'created_desc',
          hide_out_of_stock_products: false,
          max_products: null,
        },
        'polo-shirts': {
          id: 'col-polo',
          brand: 'spades',
          match_type: 'all',
          rules: [],
          sort_by: 'created_desc',
          hide_out_of_stock_products: false,
          max_products: null,
        },
      },
      membershipsByCollectionId: {
        'col-clearance': [{ product_id: 'clearance-p1', sort_order: 0 }],
        'col-polo': [{ product_id: 'polo-p1', sort_order: 0 }],
      },
    })

    const [clearance, polo] = await Promise.all([
      getCollectionListingScope(supabase as never, 'clearance-sale'),
      getCollectionListingScope(supabase as never, 'polo-shirts'),
    ])

    expect(clearance.collection?.id).toBe('col-clearance')
    expect(clearance.memberships).toEqual([{ product_id: 'clearance-p1', sort_order: 0 }])
    expect(polo.collection?.id).toBe('col-polo')
    expect(polo.memberships).toEqual([{ product_id: 'polo-p1', sort_order: 0 }])
    expect(cache.store.size).toBe(2)
  })

  it('5. Runtime Cache unavailable: fails open to a direct DB query with the correct result', async () => {
    const { getCollectionListingScope } = await freshModule()
    mockGetCache.mockImplementation(() => {
      throw new Error('No cache context available')
    })
    const supabase = fakeSupabase({
      collectionsBySlug: {
        jackets: {
          id: 'col-jackets',
          brand: 'spades',
          match_type: 'all',
          rules: [],
          sort_by: 'created_desc',
          hide_out_of_stock_products: false,
          max_products: null,
        },
      },
      membershipsByCollectionId: { 'col-jackets': [] },
    })

    const result = await getCollectionListingScope(supabase as never, 'jackets')

    expect(result.collection?.id).toBe('col-jackets')
  })

  it('5b. Runtime Cache GET failure still returns the correct, freshly-computed result', async () => {
    const { getCollectionListingScope } = await freshModule()
    const cache = createRealisticFakeCache()
    cache.get.mockRejectedValueOnce(new Error('Runtime Cache timeout'))
    mockGetCache.mockReturnValue(cache)
    const supabase = fakeSupabase({
      collectionsBySlug: {
        sando: {
          id: 'col-sando',
          brand: 'spades',
          match_type: 'all',
          rules: [],
          sort_by: 'created_desc',
          hide_out_of_stock_products: false,
          max_products: null,
        },
      },
      membershipsByCollectionId: { 'col-sando': [] },
    })

    const result = await getCollectionListingScope(supabase as never, 'sando')

    expect(result.collection?.id).toBe('col-sando')
  })

  it('8. cross-brand isolation: two collections in different brands never mix data (global unique slug, no key collision)', async () => {
    const { getCollectionListingScope } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const supabase = fakeSupabase({
      collectionsBySlug: {
        'spades-only-slug': {
          id: 'col-spades',
          brand: 'spades',
          match_type: 'all',
          rules: [],
          sort_by: 'created_desc',
          hide_out_of_stock_products: false,
          max_products: null,
        },
        'ysrael-only-slug': {
          id: 'col-ysrael',
          brand: 'ysrael',
          match_type: 'all',
          rules: [],
          sort_by: 'created_desc',
          hide_out_of_stock_products: false,
          max_products: null,
        },
      },
      membershipsByCollectionId: {
        'col-spades': [{ product_id: 'spades-product', sort_order: 0 }],
        'col-ysrael': [{ product_id: 'ysrael-product', sort_order: 0 }],
      },
    })

    const spadesResult = await getCollectionListingScope(supabase as never, 'spades-only-slug')
    const ysraelResult = await getCollectionListingScope(supabase as never, 'ysrael-only-slug')

    expect(spadesResult.collection?.brand).toBe('spades')
    expect(spadesResult.memberships).toEqual([{ product_id: 'spades-product', sort_order: 0 }])
    expect(ysraelResult.collection?.brand).toBe('ysrael')
    expect(ysraelResult.memberships).toEqual([{ product_id: 'ysrael-product', sort_order: 0 }])
  })
})

describe('invalidateCollectionListingCache', () => {
  beforeEach(() => {
    mockGetCache.mockReset()
  })

  it('6/7. calls Runtime Cache expireTag with collection:<id> for every given id', async () => {
    const { invalidateCollectionListingCache } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)

    await invalidateCollectionListingCache(['col-a', 'col-b'])

    expect(cache.expireTag).toHaveBeenCalledWith(['collection:col-a', 'collection:col-b'])
  })

  it('actually evicts a previously-cached entry tagged with the invalidated id', async () => {
    const { getCollectionListingScope, invalidateCollectionListingCache } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const supabase = fakeSupabase({
      collectionsBySlug: {
        'best-sellers': {
          id: 'col-best',
          brand: 'spades',
          match_type: 'all',
          rules: [],
          sort_by: 'created_desc',
          hide_out_of_stock_products: false,
          max_products: null,
        },
      },
      membershipsByCollectionId: { 'col-best': [{ product_id: 'p1', sort_order: 0 }] },
    })

    await getCollectionListingScope(supabase as never, 'best-sellers')
    expect(cache.store.has('best-sellers')).toBe(true)

    await invalidateCollectionListingCache(['col-best'])

    expect(cache.store.has('best-sellers')).toBe(false)
  })

  it('does not throw when Runtime Cache is unavailable (fail-open)', async () => {
    const { invalidateCollectionListingCache } = await freshModule()
    mockGetCache.mockImplementation(() => {
      throw new Error('No cache context available')
    })

    await expect(invalidateCollectionListingCache(['col-a'])).resolves.toBeUndefined()
  })
})

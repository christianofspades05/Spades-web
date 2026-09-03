import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveCollectionScopedProductIds } from './scoped-products'

const { mockGetCache } = vi.hoisted(() => ({ mockGetCache: vi.fn() }))

vi.mock('@vercel/functions', () => ({
  getCache: mockGetCache,
}))

/** A real Map-backed fake — not a bare stub — so a key-construction bug
 *  (e.g. two different collection scopes accidentally colliding on the
 *  same cache key) would actually surface as a wrong cached value being
 *  returned, the way it would in production against real Runtime Cache. */
function createRealisticFakeCache() {
  const store = new Map<string, unknown>()
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
    expireTag: vi.fn(async () => undefined),
  }
}

interface FakeCollection {
  id: string
  match_type: 'all' | 'any'
  rules: unknown[]
}

/** Minimal fake of the Supabase admin client's chained query builder — just
 *  enough surface for fetchCollectionScopeData/fetchAllProductsForRuleMatch
 *  to run against fixed, per-test fixture data. */
function fakeAdmin(fixture: {
  pinsByCollection: Record<string, string[]>
  collections: FakeCollection[]
  products: { id: string; name: string; product_type: string; status: string; tags: string[] }[]
}) {
  return {
    from(table: string) {
      if (table === 'product_collections') {
        return {
          select: () => ({
            in: async (_col: string, collectionIds: string[]) => ({
              data: collectionIds.flatMap((id) =>
                (fixture.pinsByCollection[id] ?? []).map((productId) => ({
                  product_id: productId,
                })),
              ),
              error: null,
            }),
          }),
        }
      }
      if (table === 'collections') {
        return {
          select: () => ({
            in: async (_col: string, ids: string[]) => ({
              data: fixture.collections.filter((c) => ids.includes(c.id)),
              error: null,
            }),
          }),
        }
      }
      if (table === 'products') {
        return {
          select: () => ({
            overrideTypes: async () => ({
              data: fixture.products.map((p) => ({
                ...p,
                variants: [],
              })),
              error: null,
            }),
          }),
        }
      }
      throw new Error(`Unexpected table in fake admin: ${table}`)
    },
  }
}

describe('resolveCollectionScopedProductIds — cache key determinism and isolation', () => {
  beforeEach(() => {
    mockGetCache.mockReset()
  })

  it('sorted collection IDs produce the same cache key regardless of input order', async () => {
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const admin = fakeAdmin({
      pinsByCollection: { 'col-a': ['prod-1'], 'col-b': ['prod-2'] },
      collections: [],
      products: [],
    })

    await resolveCollectionScopedProductIds(admin as never, ['col-a', 'col-b'], ['prod-1', 'prod-2'])
    await resolveCollectionScopedProductIds(admin as never, ['col-b', 'col-a'], ['prod-1', 'prod-2'])

    // Both calls resolve the exact same collection set, just permuted — they
    // must land on one shared collection-scope cache entry, not two. (The
    // store also holds one entry for the separate rule-match-products
    // cache, populated once as a side effect of the first resolve — that's
    // expected and unrelated to this determinism check.)
    const scopeKeys = [...cache.store.keys()].filter((key) => key.startsWith('collections:scope:'))
    expect(scopeKeys).toHaveLength(1)
  })

  it('different collection IDs never share a cache key or leak each other\'s membership', async () => {
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const admin = fakeAdmin({
      pinsByCollection: {
        'spades-collection': ['spades-product-1'],
        'ysrael-collection': ['ysrael-product-1'],
      },
      collections: [],
      products: [],
    })

    const spadesResult = await resolveCollectionScopedProductIds(
      admin as never,
      ['spades-collection'],
      ['spades-product-1', 'ysrael-product-1'],
    )
    const ysraelResult = await resolveCollectionScopedProductIds(
      admin as never,
      ['ysrael-collection'],
      ['spades-product-1', 'ysrael-product-1'],
    )

    expect(spadesResult.has('spades-product-1')).toBe(true)
    expect(spadesResult.has('ysrael-product-1')).toBe(false)
    expect(ysraelResult.has('ysrael-product-1')).toBe(true)
    expect(ysraelResult.has('spades-product-1')).toBe(false)

    // Two genuinely distinct collection-scope cache entries — no overwrite,
    // no shared key between the two brands' collections.
    const scopeKeys = [...cache.store.keys()].filter((key) => key.startsWith('collections:scope:'))
    expect(scopeKeys).toHaveLength(2)
  })

  it('tags every cache entry with collection:<id> for every collection in its key (Phase 2 prerequisite)', async () => {
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const admin = fakeAdmin({
      pinsByCollection: {},
      collections: [],
      products: [],
    })

    await resolveCollectionScopedProductIds(admin as never, ['col-a', 'col-b'], ['prod-1'])

    expect(cache.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ tags: expect.arrayContaining(['collection:col-a', 'collection:col-b']) }),
    )
  })

  it('falls back to a direct Supabase resolution when the cache is unavailable, and still returns correct membership', async () => {
    mockGetCache.mockImplementation(() => {
      throw new Error('Runtime Cache unavailable')
    })
    const admin = fakeAdmin({
      pinsByCollection: { 'col-a': ['prod-1'] },
      collections: [],
      products: [],
    })

    const result = await resolveCollectionScopedProductIds(admin as never, ['col-a'], ['prod-1', 'prod-2'])

    expect(result.has('prod-1')).toBe(true)
    expect(result.has('prod-2')).toBe(false)
  })

  it('recomputes from Supabase when the cached value is malformed rather than trusting it', async () => {
    const cache = createRealisticFakeCache()
    // Pre-seed a malformed entry directly, bypassing the normal set() path,
    // to simulate cache corruption or an incompatible stored shape.
    cache.store.set('collections:scope:col-a', { garbage: true })
    mockGetCache.mockReturnValue(cache)
    const admin = fakeAdmin({
      pinsByCollection: { 'col-a': ['prod-1'] },
      collections: [],
      products: [],
    })

    const result = await resolveCollectionScopedProductIds(admin as never, ['col-a'], ['prod-1'])

    expect(result.has('prod-1')).toBe(true)
  })
})

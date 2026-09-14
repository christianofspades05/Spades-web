import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetCache } = vi.hoisted(() => ({ mockGetCache: vi.fn() }))

vi.mock('@vercel/functions', () => ({
  getCache: mockGetCache,
}))

interface FakeDiscountRow {
  id: string
  code: string | null
  title: string
  type: 'percentage' | 'fixed_amount'
  value: number
  scope: 'all' | 'collection' | 'product' | 'variant'
  scope_ids: string[]
  excluded_collection_ids: string[]
  max_discounted_items: number | null
  excludes_free_shipping: boolean
  stacks_with_sale: boolean
  starts_at: string | null
  ends_at: string | null
}

/** Real Map-backed fake — same philosophy as market-pricing.test.ts's
 *  createRealisticFakeCache: a key-construction bug surfaces as a wrong
 *  cached value being returned, not just a mock call-count mismatch. */
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

/** fixture.rows is pre-filtered by the test itself to what
 *  .eq('kind','automatic').eq('is_active',true) would actually return —
 *  same convention as market-pricing.test.ts's fakeSupabase(), which
 *  pre-filters by is_active rather than modeling PostgREST's query
 *  execution. */
function fakeAdmin(fixture: { rows: FakeDiscountRow[]; queryCount: { count: number } }) {
  return {
    from(table: string) {
      if (table !== 'discounts') throw new Error(`Unexpected table: ${table}`)
      return {
        select: () => ({
          eq: () => ({
            eq: async () => {
              fixture.queryCount.count++
              return { data: fixture.rows, error: null }
            },
          }),
        }),
      }
    },
  }
}

function fakeDiscount(overrides: Partial<FakeDiscountRow> = {}): FakeDiscountRow {
  return {
    id: 'discount-1',
    code: null,
    title: 'Store Sale',
    type: 'percentage',
    value: 10,
    scope: 'all',
    scope_ids: [],
    excluded_collection_ids: [],
    max_discounted_items: null,
    excludes_free_shipping: false,
    stacks_with_sale: false,
    starts_at: null,
    ends_at: null,
    ...overrides,
  }
}

async function freshModule() {
  vi.resetModules()
  return import('./automatic-sales')
}

describe('getActiveAutomaticDiscounts — shared cache', () => {
  beforeEach(() => {
    mockGetCache.mockReset()
  })

  it('1. cold request fetches the DB', async () => {
    const { getActiveAutomaticDiscounts } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    const admin = fakeAdmin({ rows: [fakeDiscount()], queryCount }) as never

    const result = await getActiveAutomaticDiscounts(admin)

    expect(queryCount.count).toBe(1)
    expect(result).toEqual([fakeDiscount()])
  })

  it('2. warm request is served from shared cache, no second DB query', async () => {
    const { getActiveAutomaticDiscounts } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    const admin = fakeAdmin({ rows: [fakeDiscount()], queryCount }) as never

    const first = await getActiveAutomaticDiscounts(admin)
    const second = await getActiveAutomaticDiscounts(admin)

    expect(second).toEqual(first)
    expect(queryCount.count).toBe(1)
  })

  it('3. concurrent requests collapse into a single-flight DB query', async () => {
    const { getActiveAutomaticDiscounts } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    let queryCount = 0
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: async () => {
              queryCount++
              await new Promise((r) => setTimeout(r, 5))
              return { data: [fakeDiscount()], error: null }
            },
          }),
        }),
      }),
    } as never

    const results = await Promise.all(
      Array.from({ length: 10 }, () => getActiveAutomaticDiscounts(admin)),
    )

    expect(queryCount).toBe(1)
    expect(results.every((r) => r[0]?.id === 'discount-1')).toBe(true)
  })

  it('4. a discount whose starts_at is in the future is excluded, even from a cached row set', async () => {
    const { getActiveAutomaticDiscounts } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const future = new Date(Date.now() + 60_000).toISOString()
    const queryCount = { count: 0 }
    const admin = fakeAdmin({
      rows: [fakeDiscount({ starts_at: future })],
      queryCount,
    }) as never

    const result = await getActiveAutomaticDiscounts(admin)

    expect(result).toEqual([])
  })

  it("5. a discount's ends_at boundary is re-checked live on every call, not frozen by the cache", async () => {
    const { getActiveAutomaticDiscounts } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const past = new Date(Date.now() - 60_000).toISOString()
    const queryCount = { count: 0 }
    // Row is cached ACTIVE (is_active=true) but its ends_at has already
    // passed — this is exactly the scenario the raw-rows-cached /
    // date-filter-applied-fresh split exists to protect: the filtered
    // result must reflect "now" on every call, never a frozen answer from
    // whenever it was first cached.
    const admin = fakeAdmin({
      rows: [fakeDiscount({ ends_at: past })],
      queryCount,
    }) as never

    const result = await getActiveAutomaticDiscounts(admin)

    expect(result).toEqual([])
    expect(queryCount.count).toBe(1)
  })

  it('9. Runtime Cache unavailable: fails open to a direct DB query with the correct result', async () => {
    const { getActiveAutomaticDiscounts } = await freshModule()
    mockGetCache.mockImplementation(() => {
      throw new Error('No cache context available')
    })
    const queryCount = { count: 0 }
    const admin = fakeAdmin({
      rows: [fakeDiscount({ value: 20 })],
      queryCount,
    }) as never

    const result = await getActiveAutomaticDiscounts(admin)

    expect(result).toEqual([fakeDiscount({ value: 20 })])
  })
})

describe('getActiveAutomaticDiscountsFresh — bypasses the cache', () => {
  beforeEach(() => {
    mockGetCache.mockReset()
  })

  it('always hits the DB, even immediately after a cached read', async () => {
    const { getActiveAutomaticDiscounts, getActiveAutomaticDiscountsFresh } =
      await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    const admin = fakeAdmin({ rows: [fakeDiscount()], queryCount }) as never

    await getActiveAutomaticDiscounts(admin)
    expect(queryCount.count).toBe(1)

    await getActiveAutomaticDiscountsFresh(admin)
    expect(queryCount.count).toBe(2)
  })
})

describe('invalidateDiscountConfigCache', () => {
  beforeEach(() => {
    mockGetCache.mockReset()
  })

  it('calls Runtime Cache expireTag with the discount-config tag, evicting the cache', async () => {
    const { getActiveAutomaticDiscounts, invalidateDiscountConfigCache } =
      await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    const admin = fakeAdmin({ rows: [fakeDiscount()], queryCount }) as never

    await getActiveAutomaticDiscounts(admin)
    expect(cache.store.size).toBe(1)

    await invalidateDiscountConfigCache()

    expect(cache.expireTag).toHaveBeenCalledWith(['discount-config'])
    expect(cache.store.size).toBe(0)
  })

  it('a subsequent request after invalidation re-fetches from the DB with fresh data', async () => {
    const { getActiveAutomaticDiscounts, invalidateDiscountConfigCache } =
      await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    const rows = [fakeDiscount({ value: 10 })]
    const admin = fakeAdmin({ rows, queryCount }) as never

    const before = await getActiveAutomaticDiscounts(admin)
    expect(before[0]?.value).toBe(10)

    rows[0]!.value = 25 // admin edited the discount's percentage
    await invalidateDiscountConfigCache()

    const after = await getActiveAutomaticDiscounts(admin)
    expect(after[0]?.value).toBe(25)
    expect(queryCount.count).toBe(2)
  })

  it('does not throw when Runtime Cache is unavailable (fail-open)', async () => {
    const { invalidateDiscountConfigCache } = await freshModule()
    mockGetCache.mockImplementation(() => {
      throw new Error('No cache context available')
    })

    await expect(invalidateDiscountConfigCache()).resolves.toBeUndefined()
  })
})

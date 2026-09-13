import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetCache } = vi.hoisted(() => ({ mockGetCache: vi.fn() }))

vi.mock('@vercel/functions', () => ({
  getCache: mockGetCache,
}))

interface FakeMarketRow {
  markup_percent: number
  shipping_price_cents: number | null
  shipping_currency: string
  free_shipping_min_subtotal_cents: number | null
  free_shipping_min_items: number | null
  is_active: boolean
  market_countries: { country_code: string }[]
}

/** Real Map-backed fake — a key-construction bug would surface as a wrong
 *  cached value being returned, same philosophy as this session's other
 *  shared-cache tests (scoped-products.test.ts, queries.test.ts). */
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

function fakeSupabase(fixture: { markets: FakeMarketRow[]; queryCount: { count: number } }) {
  return {
    from(table: string) {
      if (table !== 'markets') throw new Error(`Unexpected table: ${table}`)
      return {
        select: () => ({
          eq: async (_col: string, _val: boolean) => {
            fixture.queryCount.count++
            return {
              data: fixture.markets.filter((m) => m.is_active),
              error: null,
            }
          },
        }),
      }
    },
  }
}

function fakeMarket(overrides: Partial<FakeMarketRow> = {}): FakeMarketRow {
  return {
    markup_percent: 10,
    shipping_price_cents: 15000,
    shipping_currency: 'KRW',
    free_shipping_min_subtotal_cents: null,
    free_shipping_min_items: null,
    is_active: true,
    market_countries: [{ country_code: 'KR' }],
    ...overrides,
  }
}

async function freshModule() {
  vi.resetModules()
  const mod = await import('./market-pricing')
  // getSupabaseServerClient is invoked directly inside the handler via a
  // fresh import each time — patched in per-test via mockGetSupabaseServer
  return mod
}

const { mockGetSupabaseServerClient } = vi.hoisted(() => ({
  mockGetSupabaseServerClient: vi.fn(),
}))
vi.mock('#/lib/supabase/server', () => ({
  getSupabaseServerClient: mockGetSupabaseServerClient,
}))

describe('getActiveMarketMarkups / getActiveMarketShipping — shared cache', () => {
  beforeEach(() => {
    mockGetCache.mockReset()
    mockGetSupabaseServerClient.mockReset()
  })

  it('1. cold request fetches the DB', async () => {
    const { fetchActiveMarketMarkups } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({ markets: [fakeMarket()], queryCount }),
    )

    const result = await fetchActiveMarketMarkups()

    expect(queryCount.count).toBe(1)
    expect(result).toEqual({ KR: 10 })
  })

  it('2. warm request is served from shared cache, no second DB query', async () => {
    const { fetchActiveMarketMarkups } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({ markets: [fakeMarket()], queryCount }),
    )

    const first = await fetchActiveMarketMarkups()
    const second = await fetchActiveMarketMarkups()

    expect(second).toEqual(first)
    expect(queryCount.count).toBe(1)
  })

  it('3. concurrent requests collapse into a single-flight DB query', async () => {
    const { fetchActiveMarketMarkups } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    let queryCount = 0
    mockGetSupabaseServerClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: async () => {
            queryCount++
            await new Promise((r) => setTimeout(r, 5))
            return { data: [fakeMarket()], error: null }
          },
        }),
      }),
    })

    const results = await Promise.all(
      Array.from({ length: 10 }, () => fetchActiveMarketMarkups()),
    )

    expect(queryCount).toBe(1)
    expect(results.every((r) => r.KR === 10)).toBe(true)
  })

  it('4. markup values are identical to the pre-batching calculation', async () => {
    const { fetchActiveMarketMarkups } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({
        markets: [
          fakeMarket({ markup_percent: 12, market_countries: [{ country_code: 'SG' }] }),
          fakeMarket({ markup_percent: 7, market_countries: [{ country_code: 'MY' }] }),
        ],
        queryCount,
      }),
    )

    const result = await fetchActiveMarketMarkups()

    expect(result).toEqual({ SG: 12, MY: 7 })
  })

  it('5. shipping values are identical to the pre-batching calculation', async () => {
    const { fetchActiveMarketShipping } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({
        markets: [
          fakeMarket({
            market_countries: [{ country_code: 'SG' }],
            shipping_price_cents: 25000,
            shipping_currency: 'SGD',
            free_shipping_min_subtotal_cents: 500000,
            free_shipping_min_items: null,
          }),
        ],
        queryCount,
      }),
    )

    const result = await fetchActiveMarketShipping()

    expect(result).toEqual({
      SG: {
        shippingPriceCents: 25000,
        shippingCurrency: 'SGD',
        freeShippingMinSubtotalCents: 500000,
        freeShippingMinItems: null,
      },
    })
  })

  it('6. countries remain isolated — a geo-guessed country and a checkout-chosen country never mix data', async () => {
    const { fetchActiveMarketMarkups, fetchActiveMarketShipping } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({
        markets: [
          fakeMarket({
            markup_percent: 15,
            market_countries: [{ country_code: 'JP' }], // e.g. geo-guessed
            shipping_currency: 'JPY',
          }),
          fakeMarket({
            markup_percent: 5,
            market_countries: [{ country_code: 'US' }], // e.g. checkout-chosen
            shipping_currency: 'USD',
          }),
        ],
        queryCount,
      }),
    )

    const markups = await fetchActiveMarketMarkups()
    const shipping = await fetchActiveMarketShipping()

    expect(markups.JP).toBe(15)
    expect(markups.US).toBe(5)
    expect(shipping.JP?.shippingCurrency).toBe('JPY')
    expect(shipping.US?.shippingCurrency).toBe('USD')
  })

  it('9. Runtime Cache unavailable: fails open to a direct DB query with the correct result', async () => {
    const { fetchActiveMarketMarkups } = await freshModule()
    mockGetCache.mockImplementation(() => {
      throw new Error('No cache context available')
    })
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({ markets: [fakeMarket({ markup_percent: 20 })], queryCount }),
    )

    const result = await fetchActiveMarketMarkups()

    expect(result).toEqual({ KR: 20 })
  })

  it('10/11. checkout and browsing receive the exact same configuration object — no separate code path exists to diverge', async () => {
    const { fetchActiveMarketMarkups } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({ markets: [fakeMarket({ markup_percent: 9 })], queryCount }),
    )

    // Simulates a "browsing" call (e.g. from CurrencyProvider) and a
    // "checkout" call (e.g. from checkout/index.tsx's loader) — both are
    // just fetchActiveMarketMarkups() with no special-cased behavior; the
    // browsing-vs-chosen-country distinction happens entirely in the
    // caller, which this task's scope does not touch.
    const browsingResult = await fetchActiveMarketMarkups()
    const checkoutResult = await fetchActiveMarketMarkups()

    expect(checkoutResult).toEqual(browsingResult)
  })
})

describe('invalidateMarketConfigCache', () => {
  beforeEach(() => {
    mockGetCache.mockReset()
    mockGetSupabaseServerClient.mockReset()
  })

  it('7/8. calls Runtime Cache expireTag with the market-config tag, evicting both caches', async () => {
    const { fetchActiveMarketMarkups, fetchActiveMarketShipping, invalidateMarketConfigCache } =
      await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({ markets: [fakeMarket()], queryCount }),
    )

    await fetchActiveMarketMarkups()
    await fetchActiveMarketShipping()
    expect(cache.store.size).toBe(2)

    await invalidateMarketConfigCache()

    expect(cache.expireTag).toHaveBeenCalledWith(['market-config'])
    expect(cache.store.size).toBe(0)
  })

  it('a subsequent request after invalidation re-fetches from the DB with fresh data', async () => {
    const { fetchActiveMarketMarkups, invalidateMarketConfigCache } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    const markets = [fakeMarket({ markup_percent: 10 })]
    mockGetSupabaseServerClient.mockReturnValue(fakeSupabase({ markets, queryCount }))

    const before = await fetchActiveMarketMarkups()
    expect(before).toEqual({ KR: 10 })

    markets[0].markup_percent = 25 // admin edited the market
    await invalidateMarketConfigCache()

    const after = await fetchActiveMarketMarkups()
    expect(after).toEqual({ KR: 25 })
    expect(queryCount.count).toBe(2)
  })

  it('does not throw when Runtime Cache is unavailable (fail-open)', async () => {
    const { invalidateMarketConfigCache } = await freshModule()
    mockGetCache.mockImplementation(() => {
      throw new Error('No cache context available')
    })

    await expect(invalidateMarketConfigCache()).resolves.toBeUndefined()
  })
})

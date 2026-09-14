import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetCache } = vi.hoisted(() => ({ mockGetCache: vi.fn() }))

vi.mock('@vercel/functions', () => ({
  getCache: mockGetCache,
}))

const { mockGetSupabaseServerClient } = vi.hoisted(() => ({
  mockGetSupabaseServerClient: vi.fn(),
}))
vi.mock('#/lib/supabase/server', () => ({
  getSupabaseServerClient: mockGetSupabaseServerClient,
}))

interface FakeBannerRow {
  text: string
  text_ja: string | null
  text_ko: string | null
  text_zh: string | null
}

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

function fakeSupabase(fixture: { rows: FakeBannerRow[]; queryCount: { count: number } }) {
  return {
    from(table: string) {
      if (table !== 'storefront_banner') throw new Error(`Unexpected table: ${table}`)
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: async () => {
                fixture.queryCount.count++
                return { data: fixture.rows, error: null }
              },
            }),
          }),
        }),
      }
    },
  }
}

function fakeBanner(overrides: Partial<FakeBannerRow> = {}): FakeBannerRow {
  return {
    text: 'Free shipping over ₱2000',
    text_ja: null,
    text_ko: null,
    text_zh: null,
    ...overrides,
  }
}

async function freshModule() {
  vi.resetModules()
  return import('./banner')
}

describe('resolveStorefrontBanner — shared cache', () => {
  beforeEach(() => {
    mockGetCache.mockReset()
    mockGetSupabaseServerClient.mockReset()
  })

  it('1. cold request fetches the DB', async () => {
    const { resolveStorefrontBanner } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({ rows: [fakeBanner()], queryCount }),
    )

    const result = await resolveStorefrontBanner('spades')

    expect(queryCount.count).toBe(1)
    expect(result).toEqual([
      { text: 'Free shipping over ₱2000', textJa: null, textKo: null, textZh: null },
    ])
  })

  it('2. warm request is served from shared cache, no second DB query', async () => {
    const { resolveStorefrontBanner } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({ rows: [fakeBanner()], queryCount }),
    )

    const first = await resolveStorefrontBanner('spades')
    const second = await resolveStorefrontBanner('spades')

    expect(second).toEqual(first)
    expect(queryCount.count).toBe(1)
  })

  it('3. concurrent requests collapse into a single-flight DB query', async () => {
    const { resolveStorefrontBanner } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    let queryCount = 0
    mockGetSupabaseServerClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: async () => {
                queryCount++
                await new Promise((r) => setTimeout(r, 5))
                return { data: [fakeBanner()], error: null }
              },
            }),
          }),
        }),
      }),
    })

    const results = await Promise.all(
      Array.from({ length: 10 }, () => resolveStorefrontBanner('spades')),
    )

    expect(queryCount).toBe(1)
    expect(results.every((r) => r[0]?.text === 'Free shipping over ₱2000')).toBe(true)
  })

  it('4. brand isolation — spades and ysrael never share a cache entry', async () => {
    const { resolveStorefrontBanner } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)

    mockGetSupabaseServerClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: (_col: string, brand: string) => ({
            eq: () => ({
              order: async () => ({
                data: [fakeBanner({ text: `${brand} banner` })],
                error: null,
              }),
            }),
          }),
        }),
      }),
    })

    const spades = await resolveStorefrontBanner('spades')
    const ysrael = await resolveStorefrontBanner('ysrael')

    expect(spades[0]?.text).toBe('spades banner')
    expect(ysrael[0]?.text).toBe('ysrael banner')
    expect(cache.store.size).toBe(2)
  })

  it('9. Runtime Cache unavailable: fails open to a direct DB query with the correct result', async () => {
    const { resolveStorefrontBanner } = await freshModule()
    mockGetCache.mockImplementation(() => {
      throw new Error('No cache context available')
    })
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({ rows: [fakeBanner({ text: 'fail-open banner' })], queryCount }),
    )

    const result = await resolveStorefrontBanner('aspire365')

    expect(result[0]?.text).toBe('fail-open banner')
  })

  it('10. a Supabase error propagates instead of silently returning an empty list', async () => {
    const { resolveStorefrontBanner } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    mockGetSupabaseServerClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: async () => ({
                data: null,
                error: new Error('connection refused'),
              }),
            }),
          }),
        }),
      }),
    })

    await expect(resolveStorefrontBanner('spades')).rejects.toThrow(
      'connection refused',
    )
  })

  it('no active rows returns an empty array (show nothing)', async () => {
    const { resolveStorefrontBanner } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({ rows: [], queryCount }),
    )

    const result = await resolveStorefrontBanner('spades')

    expect(result).toEqual([])
  })
})

describe('invalidateStorefrontBannerCache', () => {
  beforeEach(() => {
    mockGetCache.mockReset()
    mockGetSupabaseServerClient.mockReset()
  })

  it('5/6/7. invalidating one brand does not evict another brand — admin edit visible immediately', async () => {
    const { resolveStorefrontBanner, invalidateStorefrontBannerCache } =
      await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const spadesText = { value: 'Old text' }
    mockGetSupabaseServerClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: (_col: string, brand: string) => ({
            eq: () => ({
              order: async () => ({
                data: [
                  fakeBanner({ text: brand === 'spades' ? spadesText.value : 'ysrael banner' }),
                ],
                error: null,
              }),
            }),
          }),
        }),
      }),
    })

    expect((await resolveStorefrontBanner('spades'))[0]?.text).toBe('Old text')
    expect((await resolveStorefrontBanner('ysrael'))[0]?.text).toBe('ysrael banner')
    expect(cache.store.size).toBe(2)

    // Admin edits spades' banner text.
    spadesText.value = 'New text'
    await invalidateStorefrontBannerCache('spades')

    expect((await resolveStorefrontBanner('spades'))[0]?.text).toBe('New text')
    // ysrael's entry was never invalidated — still present, untouched.
    expect(cache.tagsByKey.has('storefront-banner:ysrael')).toBe(true)
  })

  it('calls Runtime Cache expireTag with only the affected brand tag', async () => {
    const { invalidateStorefrontBannerCache } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)

    await invalidateStorefrontBannerCache('aspire365')

    expect(cache.expireTag).toHaveBeenCalledWith(['storefront-banner:aspire365'])
  })

  it('does not throw when Runtime Cache is unavailable (fail-open)', async () => {
    const { invalidateStorefrontBannerCache } = await freshModule()
    mockGetCache.mockImplementation(() => {
      throw new Error('No cache context available')
    })

    await expect(
      invalidateStorefrontBannerCache('spades'),
    ).resolves.toBeUndefined()
  })
})

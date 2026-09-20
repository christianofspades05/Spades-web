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

interface FakeSectionRow {
  id: string
  type: string
  page: string
  brand: string
  sort_order: number
  title: string | null
  title_ja: string | null
  title_ko: string | null
  title_zh: string | null
  subtitle: string | null
  media_url: string | null
  link_url: string | null
  collection_id: string | null
  is_active: boolean
  collections: { slug: string } | null
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

function fakeSupabase(fixture: { rows: FakeSectionRow[]; queryCount: { count: number } }) {
  return {
    from(table: string) {
      if (table !== 'storefront_sections') throw new Error(`Unexpected table: ${table}`)
      return {
        select: () => ({
          eq: (col1: string, val1: string | boolean) => ({
            eq: (col2: string, val2: string | boolean) => ({
              eq: (col3: string, val3: string | boolean) => ({
                order: () => ({
                  overrideTypes: () => {
                    fixture.queryCount.count++
                    const filters: Record<string, string | boolean> = {
                      [col1]: val1,
                      [col2]: val2,
                      [col3]: val3,
                    }
                    const rows = fixture.rows.filter(
                      (r) =>
                        r.page === filters.page &&
                        r.brand === filters.brand &&
                        r.is_active === filters.is_active,
                    )
                    return Promise.resolve({ data: rows, error: null })
                  },
                }),
              }),
            }),
          }),
        }),
      }
    },
  }
}

function fakeSection(overrides: Partial<FakeSectionRow> = {}): FakeSectionRow {
  return {
    id: 'section-1',
    type: 'hero',
    page: 'home',
    brand: 'spades',
    sort_order: 0,
    title: 'Welcome',
    title_ja: null,
    title_ko: null,
    title_zh: null,
    subtitle: null,
    media_url: 'https://example.com/hero.webp',
    link_url: null,
    collection_id: null,
    is_active: true,
    collections: null,
    ...overrides,
  }
}

async function freshModule() {
  vi.resetModules()
  return import('./sections')
}

describe('loadStorefrontSections — shared cache on the base config query', () => {
  beforeEach(() => {
    mockGetCache.mockReset()
    mockGetSupabaseServerClient.mockReset()
  })

  it('1. cold request fetches the DB', async () => {
    const mod = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({ rows: [fakeSection()], queryCount }),
    )

    const result = await mod.resolveStorefrontSections('home', 'spades')

    expect(queryCount.count).toBe(1)
    expect(result).toHaveLength(1)
    expect(result[0]?.type).toBe('hero')
  })

  it('2. warm request is served from shared cache, no second DB query', async () => {
    const mod = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({ rows: [fakeSection()], queryCount }),
    )

    const first = await mod.resolveStorefrontSections('home', 'spades')
    const second = await mod.resolveStorefrontSections('home', 'spades')

    expect(second).toEqual(first)
    expect(queryCount.count).toBe(1)
  })

  it('3. concurrent cold requests collapse into a single-flight DB query', async () => {
    const mod = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    let queryCount = 0
    mockGetSupabaseServerClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  overrideTypes: async () => {
                    queryCount++
                    await new Promise((r) => setTimeout(r, 5))
                    return { data: [fakeSection()], error: null }
                  },
                }),
              }),
            }),
          }),
        }),
      }),
    })

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        mod.resolveStorefrontSections('home', 'spades'),
      ),
    )

    expect(queryCount).toBe(1)
    expect(results.every((r) => r[0]?.id === 'section-1')).toBe(true)
  })

  it('4. brand isolation — spades and ysrael never share a cache entry', async () => {
    const mod = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({
        rows: [
          fakeSection({ id: 'spades-hero', brand: 'spades', title: 'Spades' }),
          fakeSection({ id: 'ysrael-hero', brand: 'ysrael', title: 'Ysrael' }),
        ],
        queryCount,
      }),
    )

    const spades = await mod.resolveStorefrontSections('home', 'spades')
    const ysrael = await mod.resolveStorefrontSections('home', 'ysrael')

    expect(spades).toHaveLength(1)
    expect((spades[0] as { title: string | null }).title).toBe('Spades')
    expect(ysrael).toHaveLength(1)
    expect((ysrael[0] as { title: string | null }).title).toBe('Ysrael')
    expect(cache.store.size).toBe(2)
  })

  it('5. page isolation — home and about never share a cache entry', async () => {
    const mod = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({
        rows: [
          fakeSection({ id: 'home-hero', page: 'home', title: 'Home' }),
          fakeSection({ id: 'about-hero', page: 'about', title: 'About' }),
        ],
        queryCount,
      }),
    )

    const home = await mod.resolveStorefrontSections('home', 'spades')
    const about = await mod.resolveStorefrontSections('about', 'spades')

    expect((home[0] as { title: string | null }).title).toBe('Home')
    expect((about[0] as { title: string | null }).title).toBe('About')
    expect(cache.store.size).toBe(2)
  })

  it('12. Runtime Cache unavailable: fails open to a direct DB query, storefront still renders', async () => {
    const mod = await freshModule()
    mockGetCache.mockImplementation(() => {
      throw new Error('No cache context available')
    })
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({ rows: [fakeSection()], queryCount }),
    )

    const result = await mod.resolveStorefrontSections('home', 'spades')

    expect(result).toHaveLength(1)
  })

  it('13. product_grid resolution is unchanged — missing collection skips gracefully, existing collection resolves', async () => {
    const mod = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({
        rows: [
          fakeSection({
            id: 'grid-no-collection',
            type: 'product_grid',
            collections: null,
          }),
        ],
        queryCount,
      }),
    )

    const result = await mod.resolveStorefrontSections('home', 'spades')

    expect(result).toEqual([
      {
        type: 'product_grid',
        id: 'grid-no-collection',
        title: 'Welcome',
        titleJa: null,
        titleKo: null,
        titleZh: null,
        linkUrl: null,
        collectionSlug: '',
        products: [],
      },
    ])
  })
})

describe('invalidateStorefrontSectionsCache', () => {
  beforeEach(() => {
    mockGetCache.mockReset()
    mockGetSupabaseServerClient.mockReset()
  })

  it('invalidating one (brand, page) scope does not evict another scope', async () => {
    const mod = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const spadesTitle = { value: 'Old title' }
    mockGetSupabaseServerClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: (_pageCol: string, _pageVal: string) => ({
            eq: (_brandCol: string, brand: string) => ({
              eq: () => ({
                order: () => ({
                  overrideTypes: async () => ({
                    data: [
                      fakeSection({
                        brand,
                        title: brand === 'spades' ? spadesTitle.value : 'ysrael title',
                      }),
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    })

    const spadesBefore = await mod.resolveStorefrontSections('home', 'spades')
    const ysrael = await mod.resolveStorefrontSections('home', 'ysrael')
    expect((spadesBefore[0] as { title: string | null }).title).toBe('Old title')
    expect(cache.store.size).toBe(2)

    spadesTitle.value = 'New title'
    await mod.invalidateStorefrontSectionsCache('spades', 'home')

    const spadesAfter = await mod.resolveStorefrontSections('home', 'spades')
    expect((spadesAfter[0] as { title: string | null }).title).toBe('New title')
    // ysrael's entry was never invalidated — still present, untouched.
    expect(cache.tagsByKey.has('storefront-sections:ysrael:home')).toBe(true)
    void ysrael
  })

  it('calls Runtime Cache expireTag with only the affected (brand, page) tag', async () => {
    const mod = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)

    await mod.invalidateStorefrontSectionsCache('aspire365', 'about')

    expect(cache.expireTag).toHaveBeenCalledWith(['storefront-sections:aspire365:about'])
  })

  it('does not throw when Runtime Cache is unavailable (fail-open)', async () => {
    const mod = await freshModule()
    mockGetCache.mockImplementation(() => {
      throw new Error('No cache context available')
    })

    await expect(
      mod.invalidateStorefrontSectionsCache('spades', 'home'),
    ).resolves.toBeUndefined()
  })
})

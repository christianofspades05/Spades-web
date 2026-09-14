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

/** Real Map-backed fake — same philosophy as market-pricing.test.ts /
 *  automatic-sales.test.ts: a key-construction bug surfaces as a wrong
 *  cached value being returned. */
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

function fakeSupabase(fixture: { isActive: boolean | null; queryCount: { count: number } }) {
  return {
    from(table: string) {
      if (table !== 'storefront_maintenance_mode') throw new Error(`Unexpected table: ${table}`)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              fixture.queryCount.count++
              return {
                data: fixture.isActive === null ? null : { is_active: fixture.isActive },
                error: null,
              }
            },
          }),
        }),
      }
    },
  }
}

async function freshModule() {
  vi.resetModules()
  return import('./maintenance')
}

describe('resolveMaintenanceMode — shared cache', () => {
  beforeEach(() => {
    mockGetCache.mockReset()
    mockGetSupabaseServerClient.mockReset()
  })

  it('1. cold request fetches the DB', async () => {
    const { resolveMaintenanceMode } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({ isActive: true, queryCount }),
    )

    const result = await resolveMaintenanceMode('spades')

    expect(queryCount.count).toBe(1)
    expect(result).toBe(true)
  })

  it('2. warm request is served from shared cache, no second DB query', async () => {
    const { resolveMaintenanceMode } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({ isActive: false, queryCount }),
    )

    const first = await resolveMaintenanceMode('spades')
    const second = await resolveMaintenanceMode('spades')

    expect(second).toBe(first)
    expect(queryCount.count).toBe(1)
  })

  it('3. concurrent requests collapse into a single-flight DB query', async () => {
    const { resolveMaintenanceMode } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    let queryCount = 0
    mockGetSupabaseServerClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              queryCount++
              await new Promise((r) => setTimeout(r, 5))
              return { data: { is_active: true }, error: null }
            },
          }),
        }),
      }),
    })

    const results = await Promise.all(
      Array.from({ length: 10 }, () => resolveMaintenanceMode('spades')),
    )

    expect(queryCount).toBe(1)
    expect(results.every((r) => r === true)).toBe(true)
  })

  it('4. brand isolation — spades and ysrael never share a cache entry', async () => {
    const { resolveMaintenanceMode } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)

    let call = 0
    mockGetSupabaseServerClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: (_col: string, brand: string) => ({
            maybeSingle: async () => {
              call++
              return { data: { is_active: brand === 'ysrael' }, error: null }
            },
          }),
        }),
      }),
    })

    const spades = await resolveMaintenanceMode('spades')
    const ysrael = await resolveMaintenanceMode('ysrael')

    expect(spades).toBe(false)
    expect(ysrael).toBe(true)
    expect(call).toBe(2)
    expect(cache.store.size).toBe(2)
  })

  it('9. Runtime Cache unavailable: fails open to a direct DB query with the correct result', async () => {
    const { resolveMaintenanceMode } = await freshModule()
    mockGetCache.mockImplementation(() => {
      throw new Error('No cache context available')
    })
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({ isActive: true, queryCount }),
    )

    const result = await resolveMaintenanceMode('aspire365')

    expect(result).toBe(true)
  })

  it('10. a Supabase error propagates instead of silently returning false', async () => {
    const { resolveMaintenanceMode } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    mockGetSupabaseServerClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: new Error('connection refused'),
            }),
          }),
        }),
      }),
    })

    await expect(resolveMaintenanceMode('spades')).rejects.toThrow(
      'connection refused',
    )
  })

  it('no row for a brand defaults to false (maintenance off)', async () => {
    const { resolveMaintenanceMode } = await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const queryCount = { count: 0 }
    mockGetSupabaseServerClient.mockReturnValue(
      fakeSupabase({ isActive: null, queryCount }),
    )

    const result = await resolveMaintenanceMode('spades')

    expect(result).toBe(false)
  })
})

describe('invalidateMaintenanceModeCache', () => {
  beforeEach(() => {
    mockGetCache.mockReset()
    mockGetSupabaseServerClient.mockReset()
  })

  it('5/6. invalidating one brand does not evict another brand — turn ON then immediately visible', async () => {
    const { resolveMaintenanceMode, invalidateMaintenanceModeCache } =
      await freshModule()
    const cache = createRealisticFakeCache()
    mockGetCache.mockReturnValue(cache)
    const spadesActive = { value: false }
    mockGetSupabaseServerClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: (_col: string, brand: string) => ({
            maybeSingle: async () => ({
              data: { is_active: brand === 'spades' ? spadesActive.value : false },
              error: null,
            }),
          }),
        }),
      }),
    })

    // Cold cache for both brands.
    expect(await resolveMaintenanceMode('spades')).toBe(false)
    expect(await resolveMaintenanceMode('ysrael')).toBe(false)
    expect(cache.store.size).toBe(2)

    // Admin turns maintenance ON for spades only.
    spadesActive.value = true
    await invalidateMaintenanceModeCache('spades')

    // spades reflects the change immediately; ysrael's cache entry (a
    // different brand, never invalidated) is untouched.
    expect(await resolveMaintenanceMode('spades')).toBe(true)
    expect(cache.tagsByKey.has('storefront-maintenance:ysrael')).toBe(true)
  })

  it('does not throw when Runtime Cache is unavailable (fail-open)', async () => {
    const { invalidateMaintenanceModeCache } = await freshModule()
    mockGetCache.mockImplementation(() => {
      throw new Error('No cache context available')
    })

    await expect(
      invalidateMaintenanceModeCache('spades'),
    ).resolves.toBeUndefined()
  })
})

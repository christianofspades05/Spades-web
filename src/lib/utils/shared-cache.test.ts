import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSharedCache } from './shared-cache'

const { mockGetCache } = vi.hoisted(() => ({ mockGetCache: vi.fn() }))

vi.mock('@vercel/functions', () => ({
  getCache: mockGetCache,
}))

function fakeCache(overrides: Partial<Record<'get' | 'set' | 'delete' | 'expireTag', unknown>> = {}) {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    expireTag: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('createSharedCache', () => {
  beforeEach(() => {
    mockGetCache.mockReset()
  })

  it('returns the cached value on a hit, without calling compute', async () => {
    const cache = fakeCache({ get: vi.fn(async () => ({ hello: 'cached' })) })
    mockGetCache.mockReturnValue(cache)
    const compute = vi.fn(async () => ({ hello: 'fresh' }))

    const shared = createSharedCache<{ hello: string }>(60)
    const result = await shared.get('key', compute)

    expect(result).toEqual({ hello: 'cached' })
    expect(compute).not.toHaveBeenCalled()
  })

  it('computes and stores on a miss (cache.get returns null)', async () => {
    const cache = fakeCache()
    mockGetCache.mockReturnValue(cache)
    const compute = vi.fn(async () => ({ hello: 'fresh' }))

    const shared = createSharedCache<{ hello: string }>(60)
    const result = await shared.get('key', compute)

    expect(result).toEqual({ hello: 'fresh' })
    expect(compute).toHaveBeenCalledTimes(1)
    expect(cache.set).toHaveBeenCalledWith('key', { hello: 'fresh' }, { ttl: 60, tags: undefined })
  })

  it('passes tags through to cache.set', async () => {
    const cache = fakeCache()
    mockGetCache.mockReturnValue(cache)

    const shared = createSharedCache<string>(300)
    await shared.get('key', async () => 'value', { tags: ['collection:abc'] })

    expect(cache.set).toHaveBeenCalledWith('key', 'value', { ttl: 300, tags: ['collection:abc'] })
  })

  it('falls back to compute() when cache.get() throws — the store must keep working', async () => {
    const cache = fakeCache({
      get: vi.fn(async () => {
        throw new Error('Runtime Cache timeout')
      }),
    })
    mockGetCache.mockReturnValue(cache)
    const compute = vi.fn(async () => 'correct-result')

    const shared = createSharedCache<string>(60)
    const result = await shared.get('key', compute)

    expect(result).toBe('correct-result')
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('still returns the correct, already-computed result when cache.set() throws', async () => {
    const cache = fakeCache({
      set: vi.fn(async () => {
        throw new Error('Runtime Cache unavailable')
      }),
    })
    mockGetCache.mockReturnValue(cache)

    const shared = createSharedCache<string>(60)
    const result = await shared.get('key', async () => 'correct-result')

    expect(result).toBe('correct-result')
  })

  it('falls back to compute() when getCache() itself throws (no cache context available)', async () => {
    mockGetCache.mockImplementation(() => {
      throw new Error('No cache available in the context')
    })
    const compute = vi.fn(async () => 'correct-result')

    const shared = createSharedCache<string>(60)
    const result = await shared.get('key', compute)

    expect(result).toBe('correct-result')
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('treats a malformed/invalid cached value as a miss and recomputes', async () => {
    const cache = fakeCache({ get: vi.fn(async () => ({ unexpected: 'shape' })) })
    mockGetCache.mockReturnValue(cache)
    const isValid = (value: unknown): value is { hello: string } =>
      typeof value === 'object' && value !== null && 'hello' in value
    const compute = vi.fn(async () => ({ hello: 'fresh-and-correct' }))

    const shared = createSharedCache<{ hello: string }>(60)
    const result = await shared.get('key', compute, { isValid })

    expect(result).toEqual({ hello: 'fresh-and-correct' })
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('does not call compute() twice when isValid accepts the cached shape', async () => {
    const cache = fakeCache({ get: vi.fn(async () => ({ hello: 'cached-and-valid' })) })
    mockGetCache.mockReturnValue(cache)
    const isValid = (value: unknown): value is { hello: string } =>
      typeof value === 'object' && value !== null && 'hello' in value
    const compute = vi.fn(async () => ({ hello: 'fresh' }))

    const shared = createSharedCache<{ hello: string }>(60)
    const result = await shared.get('key', compute, { isValid })

    expect(result).toEqual({ hello: 'cached-and-valid' })
    expect(compute).not.toHaveBeenCalled()
  })

  describe('single-flight deduplication', () => {
    it('collapses 13 concurrent callers on a MISS into one get/compute/set', async () => {
      const cache = fakeCache()
      mockGetCache.mockReturnValue(cache)
      const compute = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5))
        return 'fresh-result'
      })

      const shared = createSharedCache<string>(60)
      const results = await Promise.all(
        Array.from({ length: 13 }, () => shared.get('key', compute)),
      )

      expect(results).toEqual(Array(13).fill('fresh-result'))
      expect(cache.get).toHaveBeenCalledTimes(1)
      expect(compute).toHaveBeenCalledTimes(1)
      expect(cache.set).toHaveBeenCalledTimes(1)
    })

    it('collapses 13 concurrent callers on a HIT into one get, no compute/set', async () => {
      const cache = fakeCache({ get: vi.fn(async () => 'cached-result') })
      mockGetCache.mockReturnValue(cache)
      const compute = vi.fn(async () => 'fresh-result')

      const shared = createSharedCache<string>(60)
      const results = await Promise.all(
        Array.from({ length: 13 }, () => shared.get('key', compute)),
      )

      expect(results).toEqual(Array(13).fill('cached-result'))
      expect(cache.get).toHaveBeenCalledTimes(1)
      expect(compute).not.toHaveBeenCalled()
      expect(cache.set).not.toHaveBeenCalled()
    })

    it('cleans up the in-flight map on rejection so the next call retries fresh', async () => {
      const cache = fakeCache()
      mockGetCache.mockReturnValue(cache)
      let attempt = 0
      const compute = vi.fn(async () => {
        attempt += 1
        if (attempt === 1) throw new Error('transient failure')
        return 'recovered-result'
      })

      const shared = createSharedCache<string>(60)
      await expect(shared.get('key', compute)).rejects.toThrow('transient failure')

      const result = await shared.get('key', compute)
      expect(result).toBe('recovered-result')
      expect(compute).toHaveBeenCalledTimes(2)
    })

    it('deduplicates concurrent callers even when Runtime Cache GET fails (fallback path)', async () => {
      const cache = fakeCache({
        get: vi.fn(async () => {
          throw new Error('Runtime Cache timeout')
        }),
      })
      mockGetCache.mockReturnValue(cache)
      const compute = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5))
        return 'fallback-result'
      })

      const shared = createSharedCache<string>(60)
      const results = await Promise.all(
        Array.from({ length: 13 }, () => shared.get('key', compute)),
      )

      expect(results).toEqual(Array(13).fill('fallback-result'))
      expect(cache.get).toHaveBeenCalledTimes(1)
      expect(compute).toHaveBeenCalledTimes(1)
    })

    it('returns the correct result to every waiter even when Runtime Cache SET fails', async () => {
      const cache = fakeCache({
        set: vi.fn(async () => {
          throw new Error('Runtime Cache unavailable')
        }),
      })
      mockGetCache.mockReturnValue(cache)
      const compute = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5))
        return 'correct-result'
      })

      const shared = createSharedCache<string>(60)
      const results = await Promise.all(
        Array.from({ length: 13 }, () => shared.get('key', compute)),
      )

      expect(results).toEqual(Array(13).fill('correct-result'))
      expect(compute).toHaveBeenCalledTimes(1)
    })

    it('executes different keys independently, not sharing a single in-flight operation', async () => {
      const cache = fakeCache()
      mockGetCache.mockReturnValue(cache)
      const computeA = vi.fn(async () => 'result-a')
      const computeB = vi.fn(async () => 'result-b')

      const shared = createSharedCache<string>(60)
      const [a, b] = await Promise.all([
        shared.get('key-a', computeA),
        shared.get('key-b', computeB),
      ])

      expect(a).toBe('result-a')
      expect(b).toBe('result-b')
      expect(computeA).toHaveBeenCalledTimes(1)
      expect(computeB).toHaveBeenCalledTimes(1)
    })

    it('does not serve a later, non-overlapping request from the single-flight map', async () => {
      const cache = fakeCache()
      mockGetCache.mockReturnValue(cache)
      const compute = vi.fn(async () => 'result')

      const shared = createSharedCache<string>(60)
      await shared.get('key', compute)
      await shared.get('key', compute)

      expect(cache.get).toHaveBeenCalledTimes(2)
      expect(compute).toHaveBeenCalledTimes(2)
    })
  })
})

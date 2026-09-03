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
})

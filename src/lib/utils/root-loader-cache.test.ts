import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { RootLoaderData } from '#/server/storefront/root-loader'

const { mockGetRootLoaderData } = vi.hoisted(() => ({
  mockGetRootLoaderData: vi.fn(),
}))

vi.mock('#/server/storefront/root-loader', () => ({
  getRootLoaderData: mockGetRootLoaderData,
}))

function fakeRootData(overrides: Partial<RootLoaderData> = {}): RootLoaderData {
  return {
    geoDefaultCurrency: null,
    geoCountry: null,
    storefrontScope: { brand: 'spades' } as RootLoaderData['storefrontScope'],
    maintenanceMode: false,
    banner: [],
    emailCapturePopupEnabled: false,
    ...overrides,
  }
}

// Vitest's default test environment is Node (no `window`), matching the
// SSR/server code path — the "client" tests below simulate a browser by
// stubbing a global `window`, then restore the original after each test.
// Each test re-imports the module fresh (vi.resetModules) since it holds
// its cache in module-scoped state that must not leak between cases.
async function freshModule() {
  vi.resetModules()
  return import('./root-loader-cache')
}

describe('getRootLoaderDataCached', () => {
  const hadWindow = typeof window !== 'undefined'

  beforeEach(() => {
    mockGetRootLoaderData.mockReset()
    ;(globalThis as { window?: unknown }).window = {}
  })

  afterEach(() => {
    vi.useRealTimers()
    if (!hadWindow) delete (globalThis as { window?: unknown }).window
  })

  it('1. fresh call: serverFn executes', async () => {
    mockGetRootLoaderData.mockResolvedValue(fakeRootData())
    const { getRootLoaderDataCached } = await freshModule()

    const result = await getRootLoaderDataCached()

    expect(mockGetRootLoaderData).toHaveBeenCalledTimes(1)
    expect(result).toEqual(fakeRootData())
  })

  it('2. second call within 10s: serverFn does NOT execute again', async () => {
    vi.useFakeTimers()
    mockGetRootLoaderData.mockResolvedValue(fakeRootData())
    const { getRootLoaderDataCached } = await freshModule()

    const first = await getRootLoaderDataCached()
    vi.advanceTimersByTime(5_000)
    const second = await getRootLoaderDataCached()

    expect(mockGetRootLoaderData).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })

  it('3. call after 10s: serverFn executes again', async () => {
    vi.useFakeTimers()
    mockGetRootLoaderData
      .mockResolvedValueOnce(fakeRootData({ maintenanceMode: false }))
      .mockResolvedValueOnce(fakeRootData({ maintenanceMode: true }))
    const { getRootLoaderDataCached } = await freshModule()

    const first = await getRootLoaderDataCached()
    vi.advanceTimersByTime(10_000)
    const second = await getRootLoaderDataCached()

    expect(mockGetRootLoaderData).toHaveBeenCalledTimes(2)
    expect(first.maintenanceMode).toBe(false)
    expect(second.maintenanceMode).toBe(true)
  })

  it('4. concurrent calls on empty cache: exactly one serverFn execution', async () => {
    let resolveFn!: (value: RootLoaderData) => void
    mockGetRootLoaderData.mockReturnValue(
      new Promise<RootLoaderData>((resolve) => {
        resolveFn = resolve
      }),
    )
    const { getRootLoaderDataCached } = await freshModule()

    const calls = [
      getRootLoaderDataCached(),
      getRootLoaderDataCached(),
      getRootLoaderDataCached(),
    ]
    resolveFn(fakeRootData())
    const results = await Promise.all(calls)

    expect(mockGetRootLoaderData).toHaveBeenCalledTimes(1)
    expect(results[0]).toEqual(results[1])
    expect(results[1]).toEqual(results[2])
  })

  it('5. failed serverFn: result not cached, next call retries', async () => {
    mockGetRootLoaderData
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce(fakeRootData())
    const { getRootLoaderDataCached } = await freshModule()

    await expect(getRootLoaderDataCached()).rejects.toThrow('network blip')
    const result = await getRootLoaderDataCached()

    expect(mockGetRootLoaderData).toHaveBeenCalledTimes(2)
    expect(result).toEqual(fakeRootData())
  })

  it('6. server-side (no window): always resolves fresh, cache bypassed entirely', async () => {
    delete (globalThis as { window?: unknown }).window
    mockGetRootLoaderData.mockResolvedValue(fakeRootData())
    const { getRootLoaderDataCached } = await freshModule()

    await getRootLoaderDataCached()
    await getRootLoaderDataCached()
    await getRootLoaderDataCached()

    expect(mockGetRootLoaderData).toHaveBeenCalledTimes(3)
  })

  it('7. resolved shape matches RootLoaderData exactly — existing consumers see an identical shape', async () => {
    const data = fakeRootData({
      banner: [{ text: 'Sale', textJa: null, textKo: null, textZh: null }],
      geoCountry: 'PH',
    })
    mockGetRootLoaderData.mockResolvedValue(data)
    const { getRootLoaderDataCached } = await freshModule()

    const result = await getRootLoaderDataCached()

    expect(result).toEqual(data)
    expect(Object.keys(result).sort()).toEqual(
      [
        'banner',
        'emailCapturePopupEnabled',
        'geoCountry',
        'geoDefaultCurrency',
        'maintenanceMode',
        'storefrontScope',
      ].sort(),
    )
  })
})

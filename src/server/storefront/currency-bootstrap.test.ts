import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFetchExchangeRates } = vi.hoisted(() => ({
  mockFetchExchangeRates: vi.fn(),
}))
vi.mock('#/server/currency/rates', () => ({
  fetchExchangeRates: mockFetchExchangeRates,
}))

const { mockFetchActiveMarketMarkups, mockFetchActiveMarketShipping } = vi.hoisted(() => ({
  mockFetchActiveMarketMarkups: vi.fn(),
  mockFetchActiveMarketShipping: vi.fn(),
}))
vi.mock('#/server/storefront/market-pricing', () => ({
  fetchActiveMarketMarkups: mockFetchActiveMarketMarkups,
  fetchActiveMarketShipping: mockFetchActiveMarketShipping,
}))

async function freshModule() {
  vi.resetModules()
  return import('./currency-bootstrap')
}

describe('getCurrencyMarketBootstrap', () => {
  beforeEach(() => {
    mockFetchExchangeRates.mockReset()
    mockFetchActiveMarketMarkups.mockReset()
    mockFetchActiveMarketShipping.mockReset()
  })

  it('combines all three into one response, reusing the existing fetch-and-cache functions exactly once each', async () => {
    mockFetchExchangeRates.mockResolvedValue({ USD: 0.018, KRW: 24.5 })
    mockFetchActiveMarketMarkups.mockResolvedValue({ KR: 10 })
    mockFetchActiveMarketShipping.mockResolvedValue({
      KR: {
        shippingPriceCents: 15000,
        shippingCurrency: 'KRW',
        freeShippingMinSubtotalCents: null,
        freeShippingMinItems: null,
      },
    })

    const mod = await freshModule()
    const result = await mod.fetchCurrencyMarketBootstrap()

    expect(result).toEqual({
      rates: { USD: 0.018, KRW: 24.5 },
      markups: { KR: 10 },
      shipping: {
        KR: {
          shippingPriceCents: 15000,
          shippingCurrency: 'KRW',
          freeShippingMinSubtotalCents: null,
          freeShippingMinItems: null,
        },
      },
    })
    expect(mockFetchExchangeRates).toHaveBeenCalledTimes(1)
    expect(mockFetchActiveMarketMarkups).toHaveBeenCalledTimes(1)
    expect(mockFetchActiveMarketShipping).toHaveBeenCalledTimes(1)
  })

  it('exchange rates failing alone leaves rates at {} but markups/shipping populate normally', async () => {
    mockFetchExchangeRates.mockRejectedValue(new Error('rates down'))
    mockFetchActiveMarketMarkups.mockResolvedValue({ SG: 12 })
    mockFetchActiveMarketShipping.mockResolvedValue({
      SG: {
        shippingPriceCents: 25000,
        shippingCurrency: 'SGD',
        freeShippingMinSubtotalCents: 500000,
        freeShippingMinItems: null,
      },
    })

    const mod = await freshModule()
    const result = await mod.fetchCurrencyMarketBootstrap()

    expect(result.rates).toEqual({})
    expect(result.markups).toEqual({ SG: 12 })
    expect(result.shipping).toEqual({
      SG: {
        shippingPriceCents: 25000,
        shippingCurrency: 'SGD',
        freeShippingMinSubtotalCents: 500000,
        freeShippingMinItems: null,
      },
    })
  })

  it('markups failing alone leaves markups at {} but rates/shipping populate normally', async () => {
    mockFetchExchangeRates.mockResolvedValue({ USD: 0.018 })
    mockFetchActiveMarketMarkups.mockRejectedValue(new Error('markups down'))
    mockFetchActiveMarketShipping.mockResolvedValue({ JP: { shippingPriceCents: 10000, shippingCurrency: 'JPY', freeShippingMinSubtotalCents: null, freeShippingMinItems: null } })

    const mod = await freshModule()
    const result = await mod.fetchCurrencyMarketBootstrap()

    expect(result.rates).toEqual({ USD: 0.018 })
    expect(result.markups).toEqual({})
    expect(result.shipping.JP?.shippingCurrency).toBe('JPY')
  })

  it('shipping failing alone leaves shipping at {} but rates/markups populate normally', async () => {
    mockFetchExchangeRates.mockResolvedValue({ USD: 0.018 })
    mockFetchActiveMarketMarkups.mockResolvedValue({ US: 5 })
    mockFetchActiveMarketShipping.mockRejectedValue(new Error('shipping down'))

    const mod = await freshModule()
    const result = await mod.fetchCurrencyMarketBootstrap()

    expect(result.rates).toEqual({ USD: 0.018 })
    expect(result.markups).toEqual({ US: 5 })
    expect(result.shipping).toEqual({})
  })

  it('all three failing at once resolves with all defaults instead of rejecting', async () => {
    mockFetchExchangeRates.mockRejectedValue(new Error('rates down'))
    mockFetchActiveMarketMarkups.mockRejectedValue(new Error('markups down'))
    mockFetchActiveMarketShipping.mockRejectedValue(new Error('shipping down'))

    const mod = await freshModule()
    const result = await mod.fetchCurrencyMarketBootstrap()

    expect(result).toEqual({ rates: {}, markups: {}, shipping: {} })
  })
})

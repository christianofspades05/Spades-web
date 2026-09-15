// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MarketplaceConnection } from '#/types/entities'

const { mockCallShopeeApi } = vi.hoisted(() => ({
  mockCallShopeeApi: vi.fn(),
}))

vi.mock('./client', () => ({
  callShopeeApi: mockCallShopeeApi,
  callShopeeApiMultipart: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  exchangeAuthCode: vi.fn(),
  refreshAccessToken: vi.fn(),
}))

function fakeConnection(): MarketplaceConnection {
  return {
    id: 'conn-1',
    marketplace: 'shopee',
    status: 'active',
    access_token_encrypted: 'token',
    refresh_token_encrypted: 'refresh',
    external_shop_id: 'shop-1',
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    inventory_sync_enabled: true,
    price_sync_enabled: true,
    price_markup_percent: 0,
  } as unknown as MarketplaceConnection
}

/** Routes each mocked Shopee call by path, tracking call counts per
 *  order_sn for the two enrichment endpoints — same philosophy as
 *  sync-engine.test.ts's fakeAdmin: a real per-call-site counter, not just
 *  a final-result assertion, so the skip logic itself is verified. */
function setupShopeeApi(orderSns: string[]) {
  const incomeCallsByOrderSn: Record<string, number> = {}
  const trackingCallsByOrderSn: Record<string, number> = {}

  mockCallShopeeApi.mockImplementation(async ({ path, query }: { path: string; query?: Record<string, string> }) => {
    if (path === '/api/v2/order/get_order_list') {
      return {
        order_list: orderSns.map((order_sn) => ({ order_sn })),
        more: false,
        next_cursor: '',
      }
    }
    if (path === '/api/v2/order/get_order_detail') {
      const batch = (query?.order_sn_list ?? '').split(',').filter(Boolean)
      return {
        order_list: batch.map((order_sn) => ({
          order_sn,
          order_status: 'TO_SHIP',
          create_time: 1700000000,
          total_amount: 100,
          item_list: [],
          package_list: [],
        })),
      }
    }
    if (path === '/api/v2/logistics/get_tracking_number') {
      const orderSn = query?.order_sn ?? ''
      trackingCallsByOrderSn[orderSn] = (trackingCallsByOrderSn[orderSn] ?? 0) + 1
      return { tracking_number: 'TRACK123' }
    }
    if (path === '/api/v2/payment/get_escrow_detail') {
      const orderSn = query?.order_sn ?? ''
      incomeCallsByOrderSn[orderSn] = (incomeCallsByOrderSn[orderSn] ?? 0) + 1
      return { order_income: { commission_fee: 5 } }
    }
    throw new Error(`Unexpected Shopee path in test: ${path}`)
  })

  return { incomeCallsByOrderSn, trackingCallsByOrderSn }
}

async function freshAdapter() {
  vi.resetModules()
  const mod = await import('./adapter')
  return mod.shopeeAdapter
}

describe('shopeeAdapter.pullOrders — skip fetchOrderIncome for already-imported orders', () => {
  beforeEach(() => {
    mockCallShopeeApi.mockReset()
  })

  it('NEW ORDER: fetchOrderIncome is called', async () => {
    const adapter = await freshAdapter()
    const { incomeCallsByOrderSn } = setupShopeeApi(['SN-NEW'])

    await adapter.pullOrders(fakeConnection(), new Date(0), {
      filterExistingExternalOrderIds: async () => new Set(),
    })

    expect(incomeCallsByOrderSn['SN-NEW']).toBe(1)
  })

  it('EXISTING ORDER: fetchOrderIncome is NOT called', async () => {
    const adapter = await freshAdapter()
    const { incomeCallsByOrderSn } = setupShopeeApi(['SN-EXISTING'])

    await adapter.pullOrders(fakeConnection(), new Date(0), {
      filterExistingExternalOrderIds: async () => new Set(['SN-EXISTING']),
    })

    expect(incomeCallsByOrderSn['SN-EXISTING']).toBeUndefined()
  })

  it('MIXED BATCH: income fetched only for the new order', async () => {
    const adapter = await freshAdapter()
    const { incomeCallsByOrderSn } = setupShopeeApi(['SN-NEW', 'SN-EXISTING'])

    await adapter.pullOrders(fakeConnection(), new Date(0), {
      filterExistingExternalOrderIds: async () => new Set(['SN-EXISTING']),
    })

    expect(incomeCallsByOrderSn['SN-NEW']).toBe(1)
    expect(incomeCallsByOrderSn['SN-EXISTING']).toBeUndefined()
  })

  it('REPEATED LOOKBACK: the same existing order across two consecutive polls never triggers an income fetch', async () => {
    const adapter = await freshAdapter()
    const { incomeCallsByOrderSn } = setupShopeeApi(['SN-EXISTING'])
    const filterExistingExternalOrderIds = async () => new Set(['SN-EXISTING'])

    await adapter.pullOrders(fakeConnection(), new Date(0), {
      filterExistingExternalOrderIds,
    })
    await adapter.pullOrders(fakeConnection(), new Date(0), {
      filterExistingExternalOrderIds,
    })

    expect(incomeCallsByOrderSn['SN-EXISTING']).toBeUndefined()
  })

  it('BATCH EXISTENCE LOOKUP: the callback is invoked once per pullOrders call, not once per order_sn', async () => {
    const adapter = await freshAdapter()
    setupShopeeApi(['SN-1', 'SN-2', 'SN-3'])
    const filterExistingExternalOrderIds = vi.fn(async (ids: string[]) => {
      expect(ids).toEqual(['SN-1', 'SN-2', 'SN-3'])
      return new Set<string>()
    })

    await adapter.pullOrders(fakeConnection(), new Date(0), {
      filterExistingExternalOrderIds,
    })

    expect(filterExistingExternalOrderIds).toHaveBeenCalledTimes(1)
  })

  it('LOOKUP FAILURE: a throwing callback falls back to fetching income for every order (old behavior)', async () => {
    const adapter = await freshAdapter()
    const { incomeCallsByOrderSn } = setupShopeeApi(['SN-A', 'SN-B'])

    const result = await adapter.pullOrders(fakeConnection(), new Date(0), {
      filterExistingExternalOrderIds: async () => {
        throw new Error('Supabase unavailable')
      },
    })

    expect(incomeCallsByOrderSn['SN-A']).toBe(1)
    expect(incomeCallsByOrderSn['SN-B']).toBe(1)
    expect(result).toHaveLength(2)
  })

  it('no options at all (caller omits it entirely) also falls back to fetching income for every order', async () => {
    const adapter = await freshAdapter()
    const { incomeCallsByOrderSn } = setupShopeeApi(['SN-NO-OPTIONS'])

    await adapter.pullOrders(fakeConnection(), new Date(0))

    expect(incomeCallsByOrderSn['SN-NO-OPTIONS']).toBe(1)
  })

  it('TRACKING: unchanged — still fetched for every order with a package, regardless of existing/new status', async () => {
    const adapter = await freshAdapter()
    const { trackingCallsByOrderSn } = setupShopeeApi(['SN-EXISTING-WITH-PACKAGE'])
    mockCallShopeeApi.mockImplementation(async ({ path, query }: { path: string; query?: Record<string, string> }) => {
      if (path === '/api/v2/order/get_order_list') {
        return { order_list: [{ order_sn: 'SN-EXISTING-WITH-PACKAGE' }], more: false, next_cursor: '' }
      }
      if (path === '/api/v2/order/get_order_detail') {
        return {
          order_list: [
            {
              order_sn: 'SN-EXISTING-WITH-PACKAGE',
              order_status: 'SHIPPED',
              create_time: 1700000000,
              total_amount: 100,
              item_list: [],
              package_list: [{ package_number: 'PKG-1', shipping_carrier: 'J&T' }],
            },
          ],
        }
      }
      if (path === '/api/v2/logistics/get_tracking_number') {
        const orderSn = query?.order_sn ?? ''
        trackingCallsByOrderSn[orderSn] = (trackingCallsByOrderSn[orderSn] ?? 0) + 1
        return { tracking_number: 'TRACK-EXISTING' }
      }
      if (path === '/api/v2/payment/get_escrow_detail') {
        throw new Error('should not be called for an existing order')
      }
      throw new Error(`Unexpected Shopee path in test: ${path}`)
    })

    await adapter.pullOrders(fakeConnection(), new Date(0), {
      filterExistingExternalOrderIds: async () => new Set(['SN-EXISTING-WITH-PACKAGE']),
    })

    // Tracking is fetched exactly as before this optimization — untouched
    // by whether the order is new or already imported.
    expect(trackingCallsByOrderSn['SN-EXISTING-WITH-PACKAGE']).toBe(1)
  })
})

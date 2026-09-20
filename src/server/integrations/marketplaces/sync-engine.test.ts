// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSupabaseAdminClient, mockGetAdapter } = vi.hoisted(() => ({
  mockGetSupabaseAdminClient: vi.fn(),
  mockGetAdapter: vi.fn(),
}))

vi.mock('#/lib/supabase/admin', () => ({
  getSupabaseAdminClient: mockGetSupabaseAdminClient,
}))
vi.mock('./registry', () => ({
  getAdapter: mockGetAdapter,
  IMPLEMENTED_MARKETPLACES: ['shopee', 'tiktok_shop', 'lazada'],
}))

const FAR_FUTURE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()

interface FakeConnectionRow {
  id: string
  marketplace: string
  status: string
  inventory_sync_enabled: boolean
  price_sync_enabled: boolean
  price_markup_percent: number
  token_expires_at: string
  refresh_token_encrypted: string | null
  access_token_encrypted: string
  external_shop_id: string | null
}

interface FakeMappingRow {
  id: string
  marketplace_connection_id: string
  external_variant_id: string
  external_product_id: string | null
  variant_id: string
}

/** Real Map-backed fake, tracking every query so batching can be asserted
 *  by call count, not just by final result — same philosophy as
 *  scoped-products.test.ts's createRealisticFakeCache. */
function fakeAdmin(fixture: {
  connection: FakeConnectionRow
  mappings: FakeMappingRow[]
  inventoryByVariantId: Record<string, number>
  variantsById: Record<string, { price_cents: number; product_id: string }>
  mappingUpdates: Record<string, unknown>[]
  mappingsUpdated: string[]
}) {
  const syncLogs: Record<string, unknown>[] = []
  const calls = { inventoryIn: 0, variantsIn: 0, connectionSelect: 0 }

  return {
    syncLogs,
    calls,
    from(table: string) {
      if (table === 'marketplace_connections') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  calls.connectionSelect++
                  return { data: fixture.connection, error: null }
                },
              }),
            }),
          }),
        }
      }
      if (table === 'marketplace_product_mappings') {
        return {
          select: () => ({
            eq: async () => ({ data: fixture.mappings, error: null }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              fixture.mappingUpdates.push(payload)
              fixture.mappingsUpdated.push(id)
              return { data: null, error: null }
            },
          }),
        }
      }
      if (table === 'inventory') {
        return {
          select: () => ({
            in: async (_col: string, ids: string[]) => {
              calls.inventoryIn++
              return {
                data: ids
                  .filter((id) => id in fixture.inventoryByVariantId)
                  .map((id) => ({
                    variant_id: id,
                    quantity_available: fixture.inventoryByVariantId[id],
                  })),
                error: null,
              }
            },
          }),
        }
      }
      if (table === 'product_variants') {
        return {
          select: () => ({
            in: async (_col: string, ids: string[]) => {
              calls.variantsIn++
              return {
                data: ids
                  .filter((id) => id in fixture.variantsById)
                  .map((id) => ({ id, ...fixture.variantsById[id] })),
                error: null,
              }
            },
            eq: (_col: string, id: string) => ({
              maybeSingle: async () => ({
                data: fixture.variantsById[id]
                  ? { ...fixture.variantsById[id] }
                  : null,
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'sync_logs') {
        return {
          insert: async (payload: Record<string, unknown>) => {
            syncLogs.push(payload)
            return { data: null, error: null }
          },
        }
      }
      if (table === 'discounts') {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: [], error: null }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table in fake admin: ${table}`)
    },
  }
}

function fakeConnection(
  overrides: Partial<FakeConnectionRow> = {},
): FakeConnectionRow {
  return {
    id: 'conn-1',
    marketplace: 'shopee',
    status: 'active',
    inventory_sync_enabled: true,
    price_sync_enabled: true,
    price_markup_percent: 10,
    token_expires_at: FAR_FUTURE,
    refresh_token_encrypted: 'refresh-token',
    access_token_encrypted: 'access-token',
    external_shop_id: 'shop-1',
    ...overrides,
  }
}

function fakeMapping(overrides: Partial<FakeMappingRow>): FakeMappingRow {
  return {
    id: 'mapping-1',
    marketplace_connection_id: 'conn-1',
    external_variant_id: 'ext-variant-1',
    external_product_id: 'ext-product-1',
    variant_id: 'variant-1',
    ...overrides,
  }
}

async function freshModule() {
  vi.resetModules()
  return import('./sync-engine')
}

describe('pushInventoryForAllProducts — batched inventory reads', () => {
  beforeEach(() => {
    mockGetSupabaseAdminClient.mockReset()
    mockGetAdapter.mockReset()
  })

  it('1. multiple mappings cause exactly one inventory .in() call, not one per mapping', async () => {
    const { pushInventoryForAllProducts } = await freshModule()
    const connection = fakeConnection()
    const mappings = [
      fakeMapping({ id: 'm1', variant_id: 'v1' }),
      fakeMapping({ id: 'm2', variant_id: 'v2' }),
      fakeMapping({ id: 'm3', variant_id: 'v3' }),
    ]
    const admin = fakeAdmin({
      connection,
      mappings,
      inventoryByVariantId: { v1: 10, v2: 20, v3: 30 },
      variantsById: {},
      mappingUpdates: [],
      mappingsUpdated: [],
    })
    mockGetSupabaseAdminClient.mockReturnValue(admin)
    const pushInventory = vi.fn(async () => undefined)
    mockGetAdapter.mockReturnValue({ pushInventory })

    await pushInventoryForAllProducts('shopee' as never)

    expect(admin.calls.inventoryIn).toBe(1)
    expect(pushInventory).toHaveBeenCalledTimes(3) // push count unchanged
  })

  it('2. batched result produces identical inventory values (stock buffer applied the same way)', async () => {
    const { pushInventoryForAllProducts } = await freshModule()
    const connection = fakeConnection()
    const mappings = [fakeMapping({ id: 'm1', variant_id: 'v1' })]
    const admin = fakeAdmin({
      connection,
      mappings,
      inventoryByVariantId: { v1: 10 },
      variantsById: {},
      mappingUpdates: [],
      mappingsUpdated: [],
    })
    mockGetSupabaseAdminClient.mockReturnValue(admin)
    const pushInventory = vi.fn(async () => undefined)
    mockGetAdapter.mockReturnValue({ pushInventory })

    await pushInventoryForAllProducts('shopee' as never)

    // MARKETPLACE_STOCK_BUFFER = 3 (module-private), so 10 -> 7. Same
    // formula as before batching — only the data source changed.
    expect(pushInventory).toHaveBeenCalledWith(
      expect.anything(),
      'ext-product-1',
      'ext-variant-1',
      7,
    )
  })

  it('3. duplicate variant IDs across mappings are deduped in the batch but each mapping still gets pushed', async () => {
    const { pushInventoryForAllProducts } = await freshModule()
    const connection = fakeConnection()
    const mappings = [
      fakeMapping({ id: 'm1', variant_id: 'v1', external_variant_id: 'ext-1' }),
      fakeMapping({ id: 'm2', variant_id: 'v1', external_variant_id: 'ext-2' }),
    ]
    const admin = fakeAdmin({
      connection,
      mappings,
      inventoryByVariantId: { v1: 15 },
      variantsById: {},
      mappingUpdates: [],
      mappingsUpdated: [],
    })
    mockGetSupabaseAdminClient.mockReturnValue(admin)
    const pushInventory = vi.fn(
      async (_conn: unknown, _prod: string, _variant: string, _qty: number) =>
        undefined,
    )
    mockGetAdapter.mockReturnValue({ pushInventory })

    await pushInventoryForAllProducts('shopee' as never)

    expect(admin.calls.inventoryIn).toBe(1)
    expect(pushInventory).toHaveBeenCalledTimes(2)
    for (const call of pushInventory.mock.calls) {
      expect(call[3]).toBe(12) // 15 - buffer(3), identical for both
    }
  })

  it('4. a variant with no inventory row resolves to 0, exactly as the old ?? 0 fallback', async () => {
    const { pushInventoryForAllProducts } = await freshModule()
    const connection = fakeConnection()
    const mappings = [fakeMapping({ id: 'm1', variant_id: 'v-missing' })]
    const admin = fakeAdmin({
      connection,
      mappings,
      inventoryByVariantId: {}, // no row for v-missing
      variantsById: {},
      mappingUpdates: [],
      mappingsUpdated: [],
    })
    mockGetSupabaseAdminClient.mockReturnValue(admin)
    const pushInventory = vi.fn(async () => undefined)
    mockGetAdapter.mockReturnValue({ pushInventory })

    await pushInventoryForAllProducts('shopee' as never)

    expect(pushInventory).toHaveBeenCalledWith(
      expect.anything(),
      'ext-product-1',
      'ext-variant-1',
      0, // max(0, 0 - 3)
    )
  })

  it('5. chunking: more than 200 unique variant ids triggers 2 batched .in() calls, all resolved', async () => {
    const { pushInventoryForAllProducts } = await freshModule()
    const connection = fakeConnection()
    const mappings = Array.from({ length: 250 }, (_, i) =>
      fakeMapping({
        id: `m${i}`,
        variant_id: `v${i}`,
        external_variant_id: `ext-v${i}`,
      }),
    )
    const inventoryByVariantId: Record<string, number> = {}
    mappings.forEach((_, i) => {
      inventoryByVariantId[`v${i}`] = i + 3 // buffer(3) -> i
    })
    const admin = fakeAdmin({
      connection,
      mappings,
      inventoryByVariantId,
      variantsById: {},
      mappingUpdates: [],
      mappingsUpdated: [],
    })
    mockGetSupabaseAdminClient.mockReturnValue(admin)
    const pushInventory = vi.fn(async () => undefined)
    mockGetAdapter.mockReturnValue({ pushInventory })

    const result = await pushInventoryForAllProducts('shopee' as never)

    expect(admin.calls.inventoryIn).toBe(2) // 250 ids / 200 per chunk = 2 chunks
    expect(pushInventory).toHaveBeenCalledTimes(250)
    expect(result.attempted).toBe(250)
  })
})

describe('pushInventoryForAllProducts — success logging suppressed, failures preserved', () => {
  beforeEach(() => {
    mockGetSupabaseAdminClient.mockReset()
    mockGetAdapter.mockReset()
  })

  it('successful push does NOT write a sync_logs success row, but still updates sync_status/last_synced_at', async () => {
    const { pushInventoryForAllProducts } = await freshModule()
    const connection = fakeConnection()
    const mappings = [fakeMapping({ id: 'm1', variant_id: 'v1' })]
    const admin = fakeAdmin({
      connection,
      mappings,
      inventoryByVariantId: { v1: 10 },
      variantsById: {},
      mappingUpdates: [],
      mappingsUpdated: [],
    })
    mockGetSupabaseAdminClient.mockReturnValue(admin)
    mockGetAdapter.mockReturnValue({ pushInventory: vi.fn(async () => undefined) })

    await pushInventoryForAllProducts('shopee' as never)

    expect(admin.syncLogs).toHaveLength(0)
  })

  it('a failing push still writes a sync_logs failure row and marks the mapping error', async () => {
    const { pushInventoryForAllProducts } = await freshModule()
    const connection = fakeConnection()
    const mappings = [fakeMapping({ id: 'm1', variant_id: 'v1' })]
    const mappingUpdates: Record<string, unknown>[] = []
    const admin = fakeAdmin({
      connection,
      mappings,
      inventoryByVariantId: { v1: 10 },
      variantsById: {},
      mappingUpdates,
      mappingsUpdated: [],
    })
    mockGetSupabaseAdminClient.mockReturnValue(admin)
    mockGetAdapter.mockReturnValue({
      pushInventory: vi.fn(async () => {
        throw new Error('marketplace API down')
      }),
    })

    await pushInventoryForAllProducts('shopee' as never)

    const failureLogs = admin.syncLogs.filter((l) => l.status === 'failed')
    expect(failureLogs.length).toBeGreaterThan(0)
    expect(mappingUpdates.some((u) => u.sync_status === 'error')).toBe(true)
  }, 10000)

  it('a real-time single-variant push (pushInventoryForVariant) is UNCHANGED — still logs success', async () => {
    const { pushInventoryForVariant } = await freshModule()
    const connection = fakeConnection()
    const mappings = [fakeMapping({ id: 'm1', variant_id: 'v1' })]
    const admin = {
      from(table: string) {
        if (table === 'inventory') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { quantity_available: 10 },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'marketplace_product_mappings') {
          return {
            select: () => ({
              eq: async () => ({ data: mappings, error: null }),
            }),
            update: () => ({ eq: async () => ({ data: null, error: null }) }),
          }
        }
        if (table === 'marketplace_connections') {
          return {
            select: () => ({
              in: async () => ({ data: [connection], error: null }),
            }),
          }
        }
        if (table === 'sync_logs') {
          return {
            insert: async (payload: Record<string, unknown>) => {
              syncLogs.push(payload)
              return { data: null, error: null }
            },
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    }
    const syncLogs: Record<string, unknown>[] = []
    mockGetSupabaseAdminClient.mockReturnValue(admin)
    mockGetAdapter.mockReturnValue({ pushInventory: vi.fn(async () => undefined) })

    await pushInventoryForVariant('v1')

    expect(syncLogs.some((l) => l.status === 'success')).toBe(true)
  })
})

describe('pushPriceForAllProducts — batched variant reads', () => {
  beforeEach(() => {
    mockGetSupabaseAdminClient.mockReset()
    mockGetAdapter.mockReset()
  })

  it('6. multiple mappings cause exactly one product_variants .in() call, not one per mapping', async () => {
    const { pushPriceForAllProducts } = await freshModule()
    const connection = fakeConnection()
    const mappings = [
      fakeMapping({ id: 'm1', variant_id: 'v1' }),
      fakeMapping({ id: 'm2', variant_id: 'v2' }),
    ]
    const admin = fakeAdmin({
      connection,
      mappings,
      inventoryByVariantId: {},
      variantsById: {
        v1: { price_cents: 10000, product_id: 'p1' },
        v2: { price_cents: 20000, product_id: 'p2' },
      },
      mappingUpdates: [],
      mappingsUpdated: [],
    })
    mockGetSupabaseAdminClient.mockReturnValue(admin)
    const updatePrice = vi.fn(async () => undefined)
    mockGetAdapter.mockReturnValue({ updatePrice })

    await pushPriceForAllProducts('shopee' as never)

    expect(admin.calls.variantsIn).toBe(1)
    expect(updatePrice).toHaveBeenCalledTimes(2)
  })

  it('7. resulting prices are identical — same markup formula, same rounding, on batched data', async () => {
    const { pushPriceForAllProducts } = await freshModule()
    const connection = fakeConnection({ price_markup_percent: 12.5 })
    const mappings = [fakeMapping({ id: 'm1', variant_id: 'v1' })]
    const admin = fakeAdmin({
      connection,
      mappings,
      inventoryByVariantId: {},
      variantsById: { v1: { price_cents: 9999, product_id: 'p1' } },
      mappingUpdates: [],
      mappingsUpdated: [],
    })
    mockGetSupabaseAdminClient.mockReturnValue(admin)
    const updatePrice = vi.fn(async () => undefined)
    mockGetAdapter.mockReturnValue({ updatePrice })

    await pushPriceForAllProducts('shopee' as never)

    // Math.round(9999 * 1.125) = Math.round(11248.875) = 11249 — same
    // formula as the pre-batching code, applied to the same input.
    expect(updatePrice).toHaveBeenCalledWith(
      expect.anything(),
      'ext-product-1',
      'ext-variant-1',
      11249,
    )
  })

  it('8. discounts/sale-mirroring path is unaffected — with no active discounts, price is just the markup, unchanged', async () => {
    const { pushPriceForAllProducts } = await freshModule()
    const connection = fakeConnection({ marketplace: 'shopee' })
    const mappings = [fakeMapping({ id: 'm1', variant_id: 'v1' })]
    const admin = fakeAdmin({
      connection,
      mappings,
      inventoryByVariantId: {},
      variantsById: { v1: { price_cents: 10000, product_id: 'p1' } },
      mappingUpdates: [],
      mappingsUpdated: [],
    })
    mockGetSupabaseAdminClient.mockReturnValue(admin)
    const updatePrice = vi.fn(async () => undefined)
    mockGetAdapter.mockReturnValue({ updatePrice })

    await pushPriceForAllProducts('shopee' as never)

    expect(updatePrice).toHaveBeenCalledWith(
      expect.anything(),
      'ext-product-1',
      'ext-variant-1',
      11000, // 10000 * 1.10 markup, no discount active
    )
  })

  it('9. a mapping whose variant no longer exists is skipped, not pushed — same as the old !variant early return', async () => {
    const { pushPriceForAllProducts } = await freshModule()
    const connection = fakeConnection()
    const mappings = [fakeMapping({ id: 'm1', variant_id: 'v-deleted' })]
    const admin = fakeAdmin({
      connection,
      mappings,
      inventoryByVariantId: {},
      variantsById: {}, // v-deleted genuinely doesn't exist
      mappingUpdates: [],
      mappingsUpdated: [],
    })
    mockGetSupabaseAdminClient.mockReturnValue(admin)
    const updatePrice = vi.fn(async () => undefined)
    mockGetAdapter.mockReturnValue({ updatePrice })

    await pushPriceForAllProducts('shopee' as never)

    expect(updatePrice).not.toHaveBeenCalled()
  })

  it('10. chunking: more than 200 unique variant ids triggers 2 batched .in() calls, all resolved', async () => {
    const { pushPriceForAllProducts } = await freshModule()
    const connection = fakeConnection()
    const mappings = Array.from({ length: 220 }, (_, i) =>
      fakeMapping({
        id: `m${i}`,
        variant_id: `v${i}`,
        external_variant_id: `ext-v${i}`,
      }),
    )
    const variantsById: Record<string, { price_cents: number; product_id: string }> = {}
    mappings.forEach((_, i) => {
      variantsById[`v${i}`] = { price_cents: 1000, product_id: `p${i}` }
    })
    const admin = fakeAdmin({
      connection,
      mappings,
      inventoryByVariantId: {},
      variantsById,
      mappingUpdates: [],
      mappingsUpdated: [],
    })
    mockGetSupabaseAdminClient.mockReturnValue(admin)
    const updatePrice = vi.fn(async () => undefined)
    mockGetAdapter.mockReturnValue({ updatePrice })

    const result = await pushPriceForAllProducts('shopee' as never)

    expect(admin.calls.variantsIn).toBe(2)
    expect(updatePrice).toHaveBeenCalledTimes(220)
    expect(result.attempted).toBe(220)
  })

  it('successful price push does NOT write a sync_logs success row', async () => {
    const { pushPriceForAllProducts } = await freshModule()
    const connection = fakeConnection()
    const mappings = [fakeMapping({ id: 'm1', variant_id: 'v1' })]
    const admin = fakeAdmin({
      connection,
      mappings,
      inventoryByVariantId: {},
      variantsById: { v1: { price_cents: 10000, product_id: 'p1' } },
      mappingUpdates: [],
      mappingsUpdated: [],
    })
    mockGetSupabaseAdminClient.mockReturnValue(admin)
    mockGetAdapter.mockReturnValue({ updatePrice: vi.fn(async () => undefined) })

    await pushPriceForAllProducts('shopee' as never)

    expect(admin.syncLogs).toHaveLength(0)
  })

  it('a failing price push still writes a sync_logs failure row', async () => {
    const { pushPriceForAllProducts } = await freshModule()
    const connection = fakeConnection()
    const mappings = [fakeMapping({ id: 'm1', variant_id: 'v1' })]
    const admin = fakeAdmin({
      connection,
      mappings,
      inventoryByVariantId: {},
      variantsById: { v1: { price_cents: 10000, product_id: 'p1' } },
      mappingUpdates: [],
      mappingsUpdated: [],
    })
    mockGetSupabaseAdminClient.mockReturnValue(admin)
    mockGetAdapter.mockReturnValue({
      updatePrice: vi.fn(async () => {
        throw new Error('marketplace API down')
      }),
    })

    await pushPriceForAllProducts('shopee' as never)

    const failureLogs = admin.syncLogs.filter((l) => l.status === 'failed')
    expect(failureLogs.length).toBeGreaterThan(0)
  }, 10000)

  it('pushPriceForProducts (the other, forced/scoped caller) is UNCHANGED — still logs success', async () => {
    const { pushPriceForProducts } = await freshModule()
    const connection = fakeConnection()
    const mappings = [fakeMapping({ id: 'm1', variant_id: 'v1' })]
    const syncLogs: Record<string, unknown>[] = []
    const admin = {
      from(table: string) {
        if (table === 'marketplace_connections') {
          return {
            select: () => ({
              eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: connection, error: null }) }) }),
            }),
          }
        }
        if (table === 'product_variants') {
          return {
            select: () => ({
              // pushPriceForProducts' own variant-id-by-product-id lookup
              in: async () => ({ data: [{ id: 'v1' }], error: null }),
              // repriceOneMapping's fallback fetch (no preloadedVariant is
              // passed from this caller — this path is deliberately
              // untouched by this task's scope)
              eq: () => ({
                maybeSingle: async () => ({
                  data: { price_cents: 10000, product_id: 'p1' },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'marketplace_product_mappings') {
          return {
            select: () => ({
              eq: () => ({ in: async () => ({ data: mappings, error: null }) }),
            }),
          }
        }
        if (table === 'discounts') {
          return { select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }) }
        }
        if (table === 'sync_logs') {
          return {
            insert: async (payload: Record<string, unknown>) => {
              syncLogs.push(payload)
              return { data: null, error: null }
            },
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    }
    mockGetSupabaseAdminClient.mockReturnValue(admin)
    mockGetAdapter.mockReturnValue({ updatePrice: vi.fn(async () => undefined) })

    await pushPriceForProducts('shopee' as never, ['p1'])

    expect(syncLogs.some((l) => l.status === 'success')).toBe(true)
  })
})

describe('getExistingExternalOrderIds — batched existing-order lookup', () => {
  beforeEach(() => {
    mockGetSupabaseAdminClient.mockReset()
  })

  function fakeOrdersAdmin(fixture: {
    existingIds: string[]
    queryCount: { count: number }
    throwOnQuery?: boolean
  }) {
    return {
      from(table: string) {
        if (table !== 'orders') throw new Error(`Unexpected table: ${table}`)
        return {
          select: () => ({
            eq: () => ({
              in: async (_col: string, ids: string[]) => {
                fixture.queryCount.count++
                if (fixture.throwOnQuery) {
                  return { data: null, error: new Error('connection refused') }
                }
                return {
                  data: ids
                    .filter((id) => fixture.existingIds.includes(id))
                    .map((id) => ({ external_order_id: id })),
                  error: null,
                }
              },
            }),
          }),
        }
      },
    }
  }

  it('1. returns exactly the ids that already exist, via one batched query', async () => {
    const { getExistingExternalOrderIds } = await freshModule()
    const queryCount = { count: 0 }
    mockGetSupabaseAdminClient.mockReturnValue(
      fakeOrdersAdmin({ existingIds: ['SN-1', 'SN-3'], queryCount }),
    )

    const result = await getExistingExternalOrderIds('shopee' as never, [
      'SN-1',
      'SN-2',
      'SN-3',
    ])

    expect(queryCount.count).toBe(1)
    expect(result).toEqual(new Set(['SN-1', 'SN-3']))
  })

  it('2. empty input never queries the database', async () => {
    const { getExistingExternalOrderIds } = await freshModule()
    const queryCount = { count: 0 }
    mockGetSupabaseAdminClient.mockReturnValue(
      fakeOrdersAdmin({ existingIds: [], queryCount }),
    )

    const result = await getExistingExternalOrderIds('shopee' as never, [])

    expect(queryCount.count).toBe(0)
    expect(result).toEqual(new Set())
  })

  it('3. a Supabase error fails open to an empty Set, not a thrown error', async () => {
    const { getExistingExternalOrderIds } = await freshModule()
    const queryCount = { count: 0 }
    mockGetSupabaseAdminClient.mockReturnValue(
      fakeOrdersAdmin({ existingIds: [], queryCount, throwOnQuery: true }),
    )

    const result = await getExistingExternalOrderIds('shopee' as never, ['SN-1'])

    expect(result).toEqual(new Set())
  })

  it('4. getSupabaseAdminClient itself throwing also fails open to an empty Set', async () => {
    const { getExistingExternalOrderIds } = await freshModule()
    mockGetSupabaseAdminClient.mockImplementation(() => {
      throw new Error('no admin client available')
    })

    const result = await getExistingExternalOrderIds('shopee' as never, ['SN-1'])

    expect(result).toEqual(new Set())
  })
})

describe('pullOrdersForMarketplace — wires the batched existence lookup into the adapter', () => {
  beforeEach(() => {
    mockGetSupabaseAdminClient.mockReset()
    mockGetAdapter.mockReset()
  })

  it('passes filterExistingExternalOrderIds to adapter.pullOrders, backed by exactly one Supabase query', async () => {
    const { pullOrdersForMarketplace } = await freshModule()
    const connection = {
      id: 'conn-1',
      marketplace: 'shopee',
      status: 'active',
      inventory_sync_enabled: true,
      price_sync_enabled: true,
      token_expires_at: FAR_FUTURE,
      refresh_token_encrypted: null,
      access_token_encrypted: 'token',
      external_shop_id: 'shop-1',
    }
    const queryCount = { count: 0 }
    const admin = {
      from(table: string) {
        if (table === 'marketplace_connections') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: connection, error: null }) }),
              }),
            }),
          }
        }
        if (table === 'orders') {
          return {
            select: () => ({
              eq: () => ({
                in: async () => {
                  queryCount.count++
                  return { data: [{ external_order_id: 'SN-EXISTING' }], error: null }
                },
              }),
            }),
          }
        }
        if (table === 'sync_logs') {
          return { insert: async () => ({ data: null, error: null }) }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    }
    mockGetSupabaseAdminClient.mockReturnValue(admin)

    let receivedOptions:
      | { filterExistingExternalOrderIds?: (ids: string[]) => Promise<Set<string>> }
      | undefined
    mockGetAdapter.mockReturnValue({
      pullOrders: async (
        _conn: unknown,
        _since: unknown,
        options?: { filterExistingExternalOrderIds?: (ids: string[]) => Promise<Set<string>> },
      ) => {
        receivedOptions = options
        return []
      },
    })

    await pullOrdersForMarketplace('shopee' as never, new Date(0))

    expect(receivedOptions?.filterExistingExternalOrderIds).toBeTypeOf('function')
    const resolved = await receivedOptions?.filterExistingExternalOrderIds?.([
      'SN-EXISTING',
      'SN-NEW',
    ])
    expect(resolved).toEqual(new Set(['SN-EXISTING']))
    expect(queryCount.count).toBe(1)
  })
})

const FAKE_CONNECTION = {
  id: 'conn-1',
  marketplace: 'shopee',
  status: 'active',
  inventory_sync_enabled: true,
  price_sync_enabled: true,
  token_expires_at: FAR_FUTURE,
  refresh_token_encrypted: null,
  access_token_encrypted: 'token',
  external_shop_id: 'shop-1',
}

describe('pullOrdersForMarketplace — batches the existing-order lookup', () => {
  beforeEach(() => {
    mockGetSupabaseAdminClient.mockReset()
    mockGetAdapter.mockReset()
  })

  it('resolves every already-imported order in the pull via exactly one batched query, not one per order', async () => {
    const { pullOrdersForMarketplace } = await freshModule()
    const ordersQueryCount = { count: 0 }
    const admin = {
      from(table: string) {
        if (table === 'marketplace_connections') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: FAKE_CONNECTION, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'orders') {
          return {
            select: () => ({
              eq: () => ({
                in: async (_col: string, ids: string[]) => {
                  ordersQueryCount.count++
                  // Every id passed in is already "imported" — echoes back
                  // an internal id per external id, same shape a real
                  // .in() lookup would return.
                  return {
                    data: ids.map((id) => ({
                      id: `internal-${id}`,
                      external_order_id: id,
                    })),
                    error: null,
                  }
                },
              }),
            }),
          }
        }
        if (table === 'sync_logs') {
          return { insert: async () => ({ data: null, error: null }) }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    }
    mockGetSupabaseAdminClient.mockReturnValue(admin)

    const rawOrders = [{ id: 'SN-1' }, { id: 'SN-2' }, { id: 'SN-3' }]
    mockGetAdapter.mockReturnValue({
      pullOrders: async () => rawOrders,
      mapOrderToInternalFormat: (raw: { id: string }) => ({
        externalOrderId: raw.id,
        placedAt: new Date().toISOString(),
        shippingAddress: {},
        items: [],
        subtotalCents: 0,
        discountCents: 0,
        shippingCents: 0,
        totalCents: 0,
        isPaid: true,
        isCancelled: false,
        cancellationDetail: null,
        // null short-circuits syncFulfillmentInfo before it touches the
        // database at all — isolates this test to the existing-order
        // lookup it's actually asserting on, not fulfillment-sync logic
        // already covered by intent elsewhere in this file.
        fulfillmentInfo: null,
      }),
    })

    const result = await pullOrdersForMarketplace('shopee' as never, new Date(0))

    expect(ordersQueryCount.count).toBe(1)
    expect(result).toEqual({ scanned: 3, imported: 0, failed: 0 })
  })
})

describe('pullReturnsForMarketplace — batches the per-return lookups', () => {
  beforeEach(() => {
    mockGetSupabaseAdminClient.mockReset()
    mockGetAdapter.mockReset()
  })

  it('resolves every return\'s order, order_items, and existing-return check via one batched query each, not one per return', async () => {
    const { pullReturnsForMarketplace } = await freshModule()
    const queryCounts = { orders: 0, orderItems: 0, returnsSelect: 0, returnsInsert: 0 }
    const admin = {
      from(table: string) {
        if (table === 'marketplace_connections') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: FAKE_CONNECTION, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'orders') {
          return {
            select: () => ({
              eq: () => ({
                in: async (_col: string, ids: string[]) => {
                  queryCounts.orders++
                  return {
                    data: ids.map((id) => ({
                      id: `internal-${id}`,
                      external_order_id: id,
                      customer_id: `cust-${id}`,
                    })),
                    error: null,
                  }
                },
              }),
            }),
          }
        }
        if (table === 'order_items') {
          return {
            select: () => ({
              in: async () => {
                queryCounts.orderItems++
                return { data: [], error: null }
              },
            }),
          }
        }
        if (table === 'returns') {
          return {
            select: () => ({
              in: async () => {
                queryCounts.returnsSelect++
                return { data: [], error: null }
              },
            }),
            insert: () => ({
              select: () => ({
                single: async () => {
                  queryCounts.returnsInsert++
                  return {
                    data: { id: `return-${queryCounts.returnsInsert}` },
                    error: null,
                  }
                },
              }),
            }),
          }
        }
        if (table === 'sync_logs') {
          return { insert: async () => ({ data: null, error: null }) }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    }
    mockGetSupabaseAdminClient.mockReturnValue(admin)

    const rawReturns = [{ id: 'R-1' }, { id: 'R-2' }]
    mockGetAdapter.mockReturnValue({
      pullReturns: async () => rawReturns,
      mapReturnToInternalFormat: (raw: { id: string }) => [
        {
          externalReturnId: raw.id,
          externalOrderId: `SN-${raw.id}`,
          externalVariantId: 'sku-1',
          quantity: 1,
          // Not 'refunded' — keeps justCompleted false so this test never
          // needs to fake the restock RPC, which is out of scope for what
          // it's asserting (batched lookups, not restock behavior).
          status: 'requested',
          reason: 'Changed my mind',
          refundAmountCents: 1000,
          requestedAt: new Date().toISOString(),
        },
      ],
    })

    const result = await pullReturnsForMarketplace('shopee' as never, new Date(0))

    expect(queryCounts.orders).toBe(1)
    expect(queryCounts.orderItems).toBe(1)
    expect(queryCounts.returnsSelect).toBe(1)
    expect(queryCounts.returnsInsert).toBe(2)
    expect(result).toEqual({ scanned: 2, processed: 2, failed: 0 })
  })
})

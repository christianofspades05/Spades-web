import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AutomaticDiscount } from '#/server/storefront/automatic-sales'
import type { CartItemWithVariant } from '#/types/entities'
import type * as AutomaticSalesModule from '#/server/storefront/automatic-sales'

const { activeDiscounts, excludedProductIds } = vi.hoisted(() => ({
  activeDiscounts: { current: [] as AutomaticDiscount[] },
  excludedProductIds: { current: new Set<string>() },
}))

vi.mock('#/server/storefront/automatic-sales', async (importOriginal) => {
  const actual = await importOriginal<typeof AutomaticSalesModule>()
  return {
    ...actual,
    getActiveAutomaticDiscounts: vi.fn(async () => activeDiscounts.current),
  }
})

// Every collection lookup resolves to the same fixed "excluded" set — enough
// to exercise a store-wide discount's excluded collections.
vi.mock('#/server/collections/scoped-products', () => ({
  resolveCollectionScopedProductIds: vi.fn(
    async (_admin: unknown, _collectionIds: string[], productIds: string[]) =>
      new Set(productIds.filter((id) => excludedProductIds.current.has(id))),
  ),
}))

const { resolveAutomaticDiscountsForCart, resolveBundleNudge } =
  await import('./discount')
const { resolveSalePrices } =
  await import('#/server/storefront/automatic-sales')

const admin = {} as never

function discount(overrides: Partial<AutomaticDiscount>): AutomaticDiscount {
  return {
    id: 'sale',
    code: null,
    title: 'Store Sale',
    type: 'percentage',
    value: 15,
    scope: 'all',
    scope_ids: [],
    excluded_collection_ids: [],
    max_discounted_items: null,
    excludes_free_shipping: false,
    stacks_with_sale: false,
    min_quantity: null,
    gift_collection_ids: [],
    ...overrides,
  }
}

const storeSale = discount({})
const bundle = discount({
  id: 'bundle',
  title: 'Buy 3, Extra 10% Off',
  value: 10,
  min_quantity: 3,
})

function item(id: string, quantity: number, productId = `p-${id}`) {
  return {
    id,
    quantity,
    price_cents_snapshot: 100_000,
    variant_id: `v-${id}`,
    variant: { product: { id: productId } },
  } as unknown as CartItemWithVariant
}

beforeEach(() => {
  activeDiscounts.current = []
  excludedProductIds.current = new Set()
})

describe('bundle deal in the cart', () => {
  it('does not apply below the minimum item count', async () => {
    activeDiscounts.current = [storeSale, bundle]
    const result = await resolveAutomaticDiscountsForCart(admin, [
      item('a', 1),
      item('b', 1),
    ])
    // 15% of ₱2,000 only
    expect(result?.amountCents).toBe(30_000)
  })

  it('adds on top of the store sale once the minimum is reached', async () => {
    activeDiscounts.current = [storeSale, bundle]
    const result = await resolveAutomaticDiscountsForCart(admin, [
      item('a', 2),
      item('b', 1),
    ])
    // (15% + 10%) of ₱3,000
    expect(result?.amountCents).toBe(75_000)
  })

  it('works on its own when no store sale is running', async () => {
    activeDiscounts.current = [bundle]
    const result = await resolveAutomaticDiscountsForCart(admin, [item('a', 3)])
    expect(result?.amountCents).toBe(30_000)
    expect(result?.title).toBe('Buy 3, Extra 10% Off')
  })

  it('does not count items in excluded collections', async () => {
    activeDiscounts.current = [
      discount({ ...bundle, excluded_collection_ids: ['clearance'] }),
    ]
    excludedProductIds.current = new Set(['p-c'])
    const result = await resolveAutomaticDiscountsForCart(admin, [
      item('a', 1),
      item('b', 1),
      item('c', 1),
    ])
    expect(result).toBeNull()
  })
})

describe('store sale excluded collections in the cart', () => {
  it('leaves excluded items at full price', async () => {
    activeDiscounts.current = [
      discount({ excluded_collection_ids: ['new-drop'] }),
    ]
    excludedProductIds.current = new Set(['p-b'])
    const result = await resolveAutomaticDiscountsForCart(admin, [
      item('a', 1),
      item('b', 1),
    ])
    expect(result?.amountCents).toBe(15_000)
    expect(result?.itemBreakdown.map((e) => e.cartItemId)).toEqual(['a'])
  })
})

describe('resolveBundleNudge', () => {
  it('says how many more items are needed', async () => {
    activeDiscounts.current = [storeSale, bundle]
    const nudge = await resolveBundleNudge(admin, [item('a', 1)], false)
    expect(nudge).toMatchObject({
      itemsNeeded: 2,
      type: 'percentage',
      value: 10,
    })
  })

  it('is null once the deal applies', async () => {
    activeDiscounts.current = [bundle]
    expect(await resolveBundleNudge(admin, [item('a', 3)], false)).toBeNull()
  })

  it('skips bundles a code would replace', async () => {
    activeDiscounts.current = [bundle]
    expect(await resolveBundleNudge(admin, [item('a', 1)], true)).toBeNull()
  })
})

describe('storefront sale prices', () => {
  it('never show a bundle deal as a product sale price', async () => {
    const prices = await resolveSalePrices(
      admin,
      [bundle],
      [{ id: 'p-a', priceCents: 100_000 }],
    )
    expect(prices.size).toBe(0)
  })
})

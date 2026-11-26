import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AutomaticDiscount } from '#/server/storefront/automatic-sales'
import type * as AutomaticSalesModule from '#/server/storefront/automatic-sales'
import type { CartItemWithVariant } from '#/types/entities'

const { activeDiscounts, giftProductIds } = vi.hoisted(() => ({
  activeDiscounts: { current: [] as AutomaticDiscount[] },
  giftProductIds: { current: new Set<string>() },
}))

vi.mock('#/server/storefront/automatic-sales', async (importOriginal) => ({
  ...(await importOriginal<typeof AutomaticSalesModule>()),
  getActiveAutomaticDiscounts: vi.fn(async () => activeDiscounts.current),
}))

vi.mock('#/server/collections/scoped-products', () => ({
  resolveCollectionScopedProductIds: vi.fn(
    async (_admin: unknown, _ids: string[], productIds: string[]) =>
      new Set(productIds.filter((id) => giftProductIds.current.has(id))),
  ),
}))

const { resolveFreeGiftOffer } = await import('./free-gift')

const freeGift: AutomaticDiscount = {
  id: 'gift',
  code: null,
  title: 'Buy 8, Get a Free Item',
  type: 'free_gift',
  value: 0,
  scope: 'all',
  scope_ids: [],
  excluded_collection_ids: [],
  max_discounted_items: null,
  excludes_free_shipping: false,
  stacks_with_sale: false,
  min_quantity: 8,
  gift_collection_ids: ['essentials'],
}

function item(quantity: number, isPreOrder = false) {
  return {
    id: `item-${quantity}`,
    quantity,
    price_cents_snapshot: 100_000,
    variant_id: 'v-cart',
    variant: { is_pre_order: isPreOrder, product: { id: 'p-cart' } },
  } as unknown as CartItemWithVariant
}

/** product_variants lookup for the picked variant. */
function adminWithVariant(variant: Record<string, unknown> | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: variant, error: null }),
        }),
      }),
    }),
  } as never
}

const essentialsTee = {
  id: 'v-gift',
  sku: 'ESS-TEE-M',
  size: 'M',
  color: null,
  style: null,
  cost_cents: 20_000,
  is_active: true,
  is_pre_order: false,
  inventory: [{ quantity_available: 4 }],
  product: {
    id: 'p-gift',
    name: 'Essentials Tee',
    images: ['https://img/tee.jpg'],
    status: 'active',
    brand: 'spades',
  },
}

beforeEach(() => {
  activeDiscounts.current = [freeGift]
  giftProductIds.current = new Set(['p-gift'])
})

describe('resolveFreeGiftOffer', () => {
  it('says how many more items are needed', async () => {
    const offer = await resolveFreeGiftOffer(
      adminWithVariant(null),
      [item(5)],
      null,
      'spades',
    )
    expect(offer).toMatchObject({ itemsNeeded: 3, pick: null })
  })

  it('keeps a valid pick once the cart has 8 items', async () => {
    const offer = await resolveFreeGiftOffer(
      adminWithVariant(essentialsTee),
      [item(8)],
      'v-gift',
      'spades',
    )
    expect(offer?.itemsNeeded).toBe(0)
    expect(offer?.pick).toMatchObject({
      variantId: 'v-gift',
      productName: 'Essentials Tee',
      variantLabel: 'M',
    })
  })

  it('drops the pick when the cart no longer qualifies', async () => {
    const offer = await resolveFreeGiftOffer(
      adminWithVariant(essentialsTee),
      [item(7)],
      'v-gift',
      'spades',
    )
    expect(offer?.pick).toBeNull()
  })

  it('drops a sold-out pick', async () => {
    const offer = await resolveFreeGiftOffer(
      adminWithVariant({
        ...essentialsTee,
        inventory: [{ quantity_available: 0 }],
      }),
      [item(8)],
      'v-gift',
      'spades',
    )
    expect(offer?.pick).toBeNull()
  })

  it('drops a pick outside the gift collections', async () => {
    giftProductIds.current = new Set()
    const offer = await resolveFreeGiftOffer(
      adminWithVariant(essentialsTee),
      [item(8)],
      'v-gift',
      'spades',
    )
    expect(offer?.pick).toBeNull()
  })

  it('is not offered for pre-order carts', async () => {
    const offer = await resolveFreeGiftOffer(
      adminWithVariant(null),
      [item(8, true)],
      null,
      'spades',
    )
    expect(offer).toBeNull()
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { AutomaticDiscount } from '#/server/storefront/automatic-sales'
import type { CartItemWithVariant, Discount } from '#/types/entities'

vi.mock('#/server/collections/scoped-products', () => ({
  resolveCollectionScopedProductIds: vi.fn(async () => new Set<string>()),
}))

const { resolveAffiliateCode } = await import('./discount')

const admin = {} as never

const neeko = {
  id: 'neeko',
  code: 'NEEKO777',
  title: 'NEEKO777',
  type: 'percentage',
  value: 10,
  scope: 'all',
  scope_ids: [],
  excluded_collection_ids: [],
  max_discounted_items: null,
  excludes_free_shipping: false,
  min_quantity: null,
} as unknown as Discount

const rates = {
  commission_bps: 500,
  sale_discount_percent: 1,
  sale_commission_bps: 200,
}

function item(
  id: string,
  priceCents: number,
  compareAtCents: number | null = null,
) {
  return {
    id,
    quantity: 1,
    price_cents_snapshot: priceCents,
    variant_id: `v-${id}`,
    variant: {
      compare_at_price_cents: compareAtCents,
      product: { id: `p-${id}` },
    },
  } as unknown as CartItemWithVariant
}

const storeSale: AutomaticDiscount = {
  id: 'bf',
  code: null,
  title: 'Black Friday',
  type: 'percentage',
  value: 20,
  scope: 'all',
  scope_ids: [],
  excluded_collection_ids: [],
  max_discounted_items: null,
  excludes_free_shipping: false,
  stacks_with_sale: false,
  min_quantity: null,
  gift_collection_ids: [],
}

describe('affiliate code sale mode', () => {
  it('full-price ₱996 tee gets the full 10% (₱99.60)', async () => {
    const result = await resolveAffiliateCode(
      admin,
      neeko,
      rates,
      [item('tee', 99600)],
      [],
      [],
    )
    expect(result?.amountCents).toBe(9960)
    expect(result?.affiliate).toMatchObject({
      saleItemIds: [],
      normalItemIds: ['tee'],
    })
  })

  it('a tee marked down to ₱797 gets an extra 1% (₱7.97)', async () => {
    const result = await resolveAffiliateCode(
      admin,
      neeko,
      rates,
      [item('tee', 79700, 99600)],
      [],
      [],
    )
    expect(result?.amountCents).toBe(797)
    expect(result?.affiliate?.saleItemIds).toEqual(['tee'])
  })

  it('stacks 1% on top of a store-wide sale price instead of replacing it', async () => {
    const result = await resolveAffiliateCode(
      admin,
      neeko,
      rates,
      [item('tee', 99600)],
      [storeSale],
      [],
    )
    // 20% sale (₱199.20) + 1% of the ₱796.80 sale price (₱7.97)
    expect(result?.amountCents).toBe(19920 + 797)
    expect(result?.code).toBe('NEEKO777')
    expect(result?.stackedWith.map((s) => s.title)).toEqual(['Black Friday'])
    expect(result?.affiliate?.saleItemIds).toEqual(['tee'])
  })

  it('mixed cart: 10% on the full-price line, 1% on the sale line', async () => {
    const result = await resolveAffiliateCode(
      admin,
      neeko,
      rates,
      [item('full', 99600), item('sale', 79700, 99600)],
      [],
      [],
    )
    expect(result?.amountCents).toBe(9960 + 797)
    expect(result?.itemBreakdown).toEqual([
      { cartItemId: 'full', discountedUnits: 1, discountedAmountCents: 9960 },
      { cartItemId: 'sale', discountedUnits: 1, discountedAmountCents: 797 },
    ])
    expect(result?.affiliate).toMatchObject({
      normalItemIds: ['full'],
      saleItemIds: ['sale'],
      normalCommissionBps: 500,
      saleCommissionBps: 200,
    })
  })
})

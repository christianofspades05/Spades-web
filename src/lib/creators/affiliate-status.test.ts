import { describe, expect, it } from 'vitest'
import { affiliateStatus, roiOf } from './affiliate-status'
import type { AffiliateStatusInput } from './affiliate-status'

const NOW = new Date('2026-11-27T04:00:00Z')
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString()

const base: AffiliateStatusInput = {
  hasActiveCode: true,
  lifetimeExpensesCents: 0,
  orders: 0,
  roi: null,
  lastGiftAt: null,
  ordersSinceLastGift: 0,
  profit60dCents: 0,
  spent60dCents: 0,
}

describe('affiliateStatus', () => {
  it('flags spend without an active code as No code', () => {
    expect(
      affiliateStatus(
        {
          ...base,
          hasActiveCode: false,
          lifetimeExpensesCents: 236000,
          lastGiftAt: daysAgo(5),
        },
        NOW,
      ),
    ).toBe('no_code')
  })

  it('stops a creator paid 30+ days ago with 0 orders since (Kyle/Hazzoof)', () => {
    const paid = {
      ...base,
      lifetimeExpensesCents: 476000,
      roi: -1,
      spent60dCents: 476000,
      profit60dCents: -476000,
    }
    expect(affiliateStatus({ ...paid, lastGiftAt: daysAgo(36) }, NOW)).toBe(
      'stop',
    )
    expect(affiliateStatus({ ...paid, lastGiftAt: daysAgo(32) }, NOW)).toBe(
      'stop',
    )
  })

  it('keeps a recent gift in Test even with no orders yet', () => {
    expect(
      affiliateStatus(
        {
          ...base,
          lifetimeExpensesCents: 181000,
          lastGiftAt: daysAgo(19),
          roi: -1,
        },
        NOW,
      ),
    ).toBe('test')
  })

  it('scales at ROI ≥ 2× with ≥ 5 orders (Neeko all-time)', () => {
    // 12,343.04 order profit − 1,112.74 commission − 1,850 gifts = 9,380.30
    const roi = roiOf(938030, 296274)
    expect(roi).toBeGreaterThan(3)
    expect(
      affiliateStatus(
        {
          ...base,
          lifetimeExpensesCents: 185000,
          orders: 19,
          roi,
          lastGiftAt: daysAgo(23),
          ordersSinceLastGift: 19,
        },
        NOW,
      ),
    ).toBe('scale')
  })

  it('stops on negative ROI over the last 60 days once the gift is old', () => {
    expect(
      affiliateStatus(
        {
          ...base,
          lifetimeExpensesCents: 300000,
          orders: 3,
          roi: -0.5,
          lastGiftAt: daysAgo(40),
          ordersSinceLastGift: 3,
          spent60dCents: 310000,
          profit60dCents: -150000,
        },
        NOW,
      ),
    ).toBe('stop')
  })

  it('is Not started with no spend and no orders', () => {
    expect(affiliateStatus(base, NOW)).toBe('idle')
  })

  it('ROI is null when nothing was spent', () => {
    expect(roiOf(5000, 0)).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import {
  computeSizeHealth,
  computeDaysOfStock,
  computeRotationAdjustment,
  scoreCandidate,
  selectCategorySlots,
  computeVarietySummary,
} from './scoring'
import type { ProductCandidate } from './scoring'
import type { LivePlannerConfigRow } from '#/types/live-planner'

function fakeConfig(
  overrides?: Partial<LivePlannerConfigRow>,
): LivePlannerConfigRow {
  return {
    id: 'config-1',
    basket_size: 12,
    slot_counts: {
      proven: 4,
      priority: 3,
      inventory_push: 2,
      test: 2,
      seller_pick: 1,
    },
    scoring_weights: {
      proven: {
        velocity: 35,
        inventoryHealth: 20,
        sizeAvailability: 20,
        momentum: 10,
        daysOfStock: 10,
        strategicPriority: 5,
      },
      priority: {
        velocity: 10,
        inventoryHealth: 15,
        sizeAvailability: 15,
        momentum: 10,
        daysOfStock: 5,
        strategicPriority: 45,
      },
      inventory_push: {
        velocity: 15,
        inventoryHealth: 15,
        sizeAvailability: 20,
        momentum: 5,
        daysOfStock: 40,
        strategicPriority: 5,
      },
      test: {
        velocity: 15,
        inventoryHealth: 15,
        sizeAvailability: 20,
        momentum: 20,
        daysOfStock: 5,
        strategicPriority: 25,
      },
    },
    new_product_protection_days: 7,
    max_test_appearances: 5,
    min_inventory: 5,
    min_size_health_score: 0.4,
    max_consecutive_appearances: 3,
    rotation_penalty: {
      day1: -35,
      day2: -20,
      day3: -10,
      day4Plus: 0,
      discovery7d: 5,
      discovery14d: 10,
    },
    rotation_band_pct: 0.15,
    target_new_vs_yesterday: 8,
    max_daily_carryover: 4,
    cooldown_days: {
      proven: 1,
      priority: 0,
      inventory_push: 2,
      test: 4,
      seller_pick: 0,
    },
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function fakeCandidate(overrides?: Partial<ProductCandidate>): ProductCandidate {
  return {
    productId: 'p1',
    productName: 'Test Product',
    imageUrl: null,
    createdAt: new Date(Date.now() - 90 * 86_400_000).toISOString(),
    currentStockOnHand: 100,
    recentVelocityUnitsPerDay: 5,
    priorVelocityUnitsPerDay: 5,
    sizeHealthScore: 0.9,
    liveEligible: true,
    manualLiveLock: false,
    manualPriority: false,
    anchorProduct: false,
    lastFeaturedDaysAgo: null,
    consecutiveDaysFeatured: 0,
    testAppearanceCount: 0,
    ...overrides,
  }
}

describe('computeSizeHealth', () => {
  it('penalizes a product whose best-selling sizes are out of stock, even with high total stock (Product A example)', () => {
    // XS=40, S=30, M=0, L=0, XL=20, 2XL=10 — but M/L are the sizes that
    // actually sold historically; XS/2XL barely sold at all.
    const wellDistributed = computeSizeHealth([
      { quantityAvailable: 10, historicalUnitsSold: 5 }, // XS
      { quantityAvailable: 10, historicalUnitsSold: 5 }, // S
      { quantityAvailable: 10, historicalUnitsSold: 40 }, // M — best seller, healthy
      { quantityAvailable: 10, historicalUnitsSold: 40 }, // L — best seller, healthy
      { quantityAvailable: 0, historicalUnitsSold: 5 }, // XL
      { quantityAvailable: 0, historicalUnitsSold: 5 }, // 2XL
    ])

    const poorlyDistributed = computeSizeHealth([
      { quantityAvailable: 40, historicalUnitsSold: 5 }, // XS — well stocked, barely sells
      { quantityAvailable: 30, historicalUnitsSold: 5 }, // S — well stocked, barely sells
      { quantityAvailable: 0, historicalUnitsSold: 40 }, // M — best seller, OUT OF STOCK
      { quantityAvailable: 0, historicalUnitsSold: 40 }, // L — best seller, OUT OF STOCK
      { quantityAvailable: 20, historicalUnitsSold: 5 }, // XL
      { quantityAvailable: 10, historicalUnitsSold: 5 }, // 2XL
    ])

    expect(wellDistributed).toBeGreaterThan(poorlyDistributed)
    // Poorly distributed: ~80% of historical demand (M+L) is completely
    // unavailable, so health should be low despite 100 total units in stock.
    expect(poorlyDistributed).toBeLessThan(0.3)
    expect(wellDistributed).toBeGreaterThan(0.7)
  })

  it('falls back to equal weighting for a product with no sales history', () => {
    const health = computeSizeHealth([
      { quantityAvailable: 10, historicalUnitsSold: 0 },
      { quantityAvailable: 0, historicalUnitsSold: 0 },
    ])
    // One of two sizes in stock, no demand data to weight by — 50%.
    expect(health).toBeCloseTo(0.5, 1)
  })

  it('returns 0 for a product with no variants at all', () => {
    expect(computeSizeHealth([])).toBe(0)
  })
})

describe('computeDaysOfStock', () => {
  it('returns null when there is no velocity to divide by', () => {
    expect(computeDaysOfStock(100, 0)).toBeNull()
  })

  it('divides stock by daily velocity', () => {
    expect(computeDaysOfStock(100, 5)).toBe(20)
  })
})

describe('computeRotationAdjustment', () => {
  const penalty = fakeConfig().rotation_penalty

  it('applies the full penalty for a product featured yesterday', () => {
    expect(computeRotationAdjustment(1, false, penalty)).toBe(-35)
  })

  it('applies a discovery bonus for a product not featured in 10 days', () => {
    expect(computeRotationAdjustment(10, false, penalty)).toBe(5)
  })

  it('applies the largest discovery bonus for a product never featured', () => {
    expect(computeRotationAdjustment(null, false, penalty)).toBe(10)
  })

  it('halves the penalty (never fully exempts) for an anchor product', () => {
    expect(computeRotationAdjustment(1, true, penalty)).toBe(-17.5)
  })

  it('does not halve a positive discovery bonus for an anchor', () => {
    expect(computeRotationAdjustment(10, true, penalty)).toBe(5)
  })
})

describe('scoreCandidate', () => {
  it('never sacrifices a much stronger product for rotation variety — the "score-94 vs score-30" rule', () => {
    const config = fakeConfig()
    const strong = fakeCandidate({
      productId: 'strong',
      recentVelocityUnitsPerDay: 20,
      priorVelocityUnitsPerDay: 15,
      sizeHealthScore: 0.95,
      currentStockOnHand: 300,
      lastFeaturedDaysAgo: 1, // featured yesterday — full penalty applies
    })
    const weak = fakeCandidate({
      productId: 'weak',
      recentVelocityUnitsPerDay: 0.5,
      priorVelocityUnitsPerDay: 0.5,
      sizeHealthScore: 0.2,
      currentStockOnHand: 50,
      lastFeaturedDaysAgo: null, // never featured — max discovery bonus
    })
    const pool = { maxVelocity: 20, maxDaysOfStock: 100 }

    const strongScored = scoreCandidate(strong, 'proven', config, pool)
    const weakScored = scoreCandidate(weak, 'proven', config, pool)

    expect(strongScored.finalScore).toBeGreaterThan(weakScored.finalScore)
  })

  it('gives a strategic-priority credit to a product within its new-product-protection window', () => {
    const config = fakeConfig()
    const brandNew = fakeCandidate({
      createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      recentVelocityUnitsPerDay: 0,
      priorVelocityUnitsPerDay: 0,
    })
    const old = fakeCandidate({
      createdAt: new Date(Date.now() - 200 * 86_400_000).toISOString(),
      recentVelocityUnitsPerDay: 0,
      priorVelocityUnitsPerDay: 0,
      manualPriority: false,
    })
    const pool = { maxVelocity: 10, maxDaysOfStock: 50 }

    const newScored = scoreCandidate(brandNew, 'priority', config, pool)
    const oldScored = scoreCandidate(old, 'priority', config, pool)

    expect(newScored.isNewProduct).toBe(true)
    expect(newScored.factors.strategicPriority).toBe(1)
    expect(oldScored.factors.strategicPriority).toBe(0)
    expect(newScored.rawScore).toBeGreaterThan(oldScored.rawScore)
  })

  it('rewards high days-of-stock for inventory_push but not for proven', () => {
    const config = fakeConfig()
    const highStock = fakeCandidate({
      currentStockOnHand: 500,
      recentVelocityUnitsPerDay: 2,
      priorVelocityUnitsPerDay: 2,
    })
    const pool = { maxVelocity: 10, maxDaysOfStock: 250 } // 500/2 = 250 days

    const pushScored = scoreCandidate(highStock, 'inventory_push', config, pool)
    expect(pushScored.factors.daysOfStock).toBeCloseTo(1, 1)
  })
})

describe('selectCategorySlots', () => {
  it('picks the least-recently-featured candidate among a rotation band of similarly-scored products', () => {
    const scored = [
      {
        productId: 'a',
        productName: 'A',
        imageUrl: null,
        category: 'proven' as const,
        rawScore: 90,
        rotationAdjustment: 0,
        finalScore: 90,
        factors: {
          velocity: 1,
          inventoryHealth: 1,
          sizeAvailability: 1,
          momentum: 1,
          daysOfStock: 1,
          strategicPriority: 0,
        },
        isNewProduct: false,
        isAnchor: false,
        reason: '',
      },
      {
        productId: 'b',
        productName: 'B',
        imageUrl: null,
        category: 'proven' as const,
        rawScore: 88,
        rotationAdjustment: 0,
        finalScore: 88,
        factors: {
          velocity: 1,
          inventoryHealth: 1,
          sizeAvailability: 1,
          momentum: 1,
          daysOfStock: 1,
          strategicPriority: 0,
        },
        isNewProduct: false,
        isAnchor: false,
        reason: '',
      },
      {
        productId: 'c',
        productName: 'C',
        imageUrl: null,
        category: 'proven' as const,
        rawScore: 40, // well below the 15% band around 90 — never selected
        rotationAdjustment: 0,
        finalScore: 40,
        factors: {
          velocity: 0.2,
          inventoryHealth: 0.2,
          sizeAvailability: 0.2,
          momentum: 0.2,
          daysOfStock: 0.2,
          strategicPriority: 0,
        },
        isNewProduct: false,
        isAnchor: false,
        reason: '',
      },
    ]

    // 'a' was featured yesterday, 'b' hasn't been featured in 10 days —
    // both are within the rotation band (88 >= 90*0.85=76.5), so 'b' should
    // win the single slot despite scoring slightly lower.
    const lastFeatured = new Map([
      ['a', 1],
      ['b', 10],
      ['c', null],
    ])

    const selected = selectCategorySlots(scored, 1, 0.15, lastFeatured)
    expect(selected).toHaveLength(1)
    expect(selected[0].productId).toBe('b')
  })

  it('never selects a candidate outside the rotation band just for variety', () => {
    const scored = [
      {
        productId: 'best',
        productName: 'Best',
        imageUrl: null,
        category: 'proven' as const,
        rawScore: 94,
        rotationAdjustment: 0,
        finalScore: 94,
        factors: {
          velocity: 1,
          inventoryHealth: 1,
          sizeAvailability: 1,
          momentum: 1,
          daysOfStock: 1,
          strategicPriority: 0,
        },
        isNewProduct: false,
        isAnchor: false,
        reason: '',
      },
      {
        productId: 'weak',
        productName: 'Weak',
        imageUrl: null,
        category: 'proven' as const,
        rawScore: 30,
        rotationAdjustment: 0,
        finalScore: 30,
        factors: {
          velocity: 0.1,
          inventoryHealth: 0.1,
          sizeAvailability: 0.1,
          momentum: 0.1,
          daysOfStock: 0.1,
          strategicPriority: 0,
        },
        isNewProduct: false,
        isAnchor: false,
        reason: '',
      },
    ]
    // "best" was just featured, "weak" has never been featured — but the
    // gap (94 vs 30) is far outside any reasonable rotation band.
    const lastFeatured = new Map([
      ['best', 1],
      ['weak', null],
    ])

    const selected = selectCategorySlots(scored, 1, 0.15, lastFeatured)
    expect(selected[0].productId).toBe('best')
  })
})

describe('computeVarietySummary', () => {
  it('reports repeated products with their exemption reason', () => {
    const summary = computeVarietySummary(
      [
        {
          productId: 'a',
          productName: 'Anchor Product',
          isAnchor: true,
          isNewProduct: false,
          manualPriority: false,
          manualLiveLock: false,
        },
        {
          productId: 'b',
          productName: 'New Product',
          isAnchor: false,
          isNewProduct: true,
          manualPriority: false,
          manualLiveLock: false,
        },
        {
          productId: 'c',
          productName: 'Fresh Product',
          isAnchor: false,
          isNewProduct: false,
          manualPriority: false,
          manualLiveLock: false,
        },
      ],
      new Set(['a', 'b']), // a and b were in yesterday's basket
      new Set(['a', 'b', 'c', 'd', 'e']),
    )

    expect(summary.totalCount).toBe(3)
    expect(summary.repeatedCount).toBe(2)
    expect(summary.newCount).toBe(1)
    expect(summary.varietyScorePct).toBe(33)
    expect(summary.sevenDayUniqueProductCount).toBe(5)
    expect(summary.repeated).toEqual([
      { productId: 'a', productName: 'Anchor Product', reason: 'Anchor / strong recent performance' },
      { productId: 'b', productName: 'New Product', reason: 'New release protection' },
    ])
  })
})

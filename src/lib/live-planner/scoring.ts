import type {
  LiveBasketCategory,
  LivePlannerConfigRow,
} from '#/types/live-planner'

/**
 * Everything the scoring engine needs about one product to evaluate it for
 * a basket slot — the caller (server function) is responsible for
 * assembling this from products/product_variants/inventory/order_items/
 * product_live_flags/live_basket_items; this module never touches the
 * database itself, so every rule here is unit-testable without one.
 */
export interface ProductCandidate {
  productId: string
  productName: string
  imageUrl: string | null
  createdAt: string
  currentStockOnHand: number
  /** Units/day over the recent window (e.g. last 7 days). */
  recentVelocityUnitsPerDay: number
  /** Units/day over the window before that (e.g. days 8-14 ago) — the
   *  baseline momentum is measured against. */
  priorVelocityUnitsPerDay: number
  /** 0-1, precomputed by computeSizeHealth below from this product's own
   *  variant-level stock + historical per-variant sales share. */
  sizeHealthScore: number
  liveEligible: boolean
  manualLiveLock: boolean
  manualPriority: boolean
  anchorProduct: boolean
  /** Days since this product last appeared in any finalized basket, across
   *  any category — null if it's never been featured at all. */
  lastFeaturedDaysAgo: number | null
  /** How many of the most recent consecutive shifts (in shift order, not
   *  calendar days) featured this product with no gap. */
  consecutiveDaysFeatured: number
  /** How many times this product has appeared specifically in the 'test'
   *  category, ever — independent of consecutiveDaysFeatured. */
  testAppearanceCount: number
}

export interface ScoreFactors {
  velocity: number
  inventoryHealth: number
  sizeAvailability: number
  momentum: number
  daysOfStock: number
  strategicPriority: number
}

/** The exact shape persisted to live_basket_items.score_snapshot — a
 *  concrete interface rather than Record<string, unknown> so it survives
 *  TanStack Start's server-fn return-value serialization check. */
export interface ScoreSnapshot {
  rawScore: number
  rotationAdjustment: number
  finalScore: number
  factors: ScoreFactors
  reason: string
}

export interface ScoredCandidate {
  productId: string
  productName: string
  imageUrl: string | null
  category: LiveBasketCategory
  /** 0-100 weighted composite before the rotation adjustment. */
  rawScore: number
  /** Points added/subtracted for recent exposure (see rotation_penalty in
   *  live_planner_config) — negative for recently featured, positive
   *  ("discovery bonus") for products that haven't been shown in a while. */
  rotationAdjustment: number
  /** rawScore + rotationAdjustment, clamped to [0, 100] — what candidates
   *  are actually ranked and selected on. */
  finalScore: number
  factors: ScoreFactors
  isNewProduct: boolean
  isAnchor: boolean
  reason: string
}

const HEALTHY_SIZE_STOCK_UNITS = 5
const INVENTORY_HEALTH_TARGET_RUNWAY_DAYS = 14
/** Momentum ratio is clamped to [-1, +2] (100% decline to 200% growth)
 *  before being mapped onto the 0-1 factor scale — a single outlier week
 *  (e.g. one huge order) shouldn't send momentum off an unbounded scale. */
const MOMENTUM_RATIO_MIN = -1
const MOMENTUM_RATIO_MAX = 2

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Weighted by each variant's own historical share of this product's sales,
 * not by variant count — this is what makes a product with 100 units total
 * stock, but zero left in its two best-selling sizes, score far worse than
 * one with balanced coverage across the sizes that actually sell (the
 * exact case called out in the original request: XS/2XL well-stocked,
 * M/L (the sizes that actually move) at zero).
 *
 * A brand-new product with no sales history at all falls back to equal
 * weighting per variant, since there's no demand signal yet to weight by.
 */
export function computeSizeHealth(
  variants: Array<{ quantityAvailable: number; historicalUnitsSold: number }>,
): number {
  if (variants.length === 0) return 0
  const totalHistoricalSold = variants.reduce(
    (sum, v) => sum + v.historicalUnitsSold,
    0,
  )
  const weights =
    totalHistoricalSold > 0
      ? variants.map((v) => v.historicalUnitsSold / totalHistoricalSold)
      : variants.map(() => 1 / variants.length)

  return variants.reduce((health, v, i) => {
    const perSizeHealth = clamp(
      v.quantityAvailable / HEALTHY_SIZE_STOCK_UNITS,
      0,
      1,
    )
    return health + weights[i] * perSizeHealth
  }, 0)
}

export function computeDaysOfStock(
  currentStockOnHand: number,
  velocityUnitsPerDay: number,
): number | null {
  if (velocityUnitsPerDay <= 0) return null
  return currentStockOnHand / velocityUnitsPerDay
}

function momentumScore(
  recentVelocity: number,
  priorVelocity: number,
): number {
  if (priorVelocity <= 0) return recentVelocity > 0 ? 1 : 0.5
  const ratio = (recentVelocity - priorVelocity) / priorVelocity
  const clamped = clamp(ratio, MOMENTUM_RATIO_MIN, MOMENTUM_RATIO_MAX)
  // Maps [-1, +2] linearly onto [0, 1] — 0% change (ratio=0) lands at 1/3,
  // not the middle, since holding steady is only mildly positive, not
  // neutral: momentum specifically rewards growth.
  return (clamped - MOMENTUM_RATIO_MIN) / (MOMENTUM_RATIO_MAX - MOMENTUM_RATIO_MIN)
}

function inventoryHealthScore(
  currentStockOnHand: number,
  velocityUnitsPerDay: number,
): number {
  if (velocityUnitsPerDay <= 0) {
    // No sales signal yet (new product) — can't call this unhealthy, but
    // can't call it fully healthy either without any demand confirmed.
    return currentStockOnHand > 0 ? 0.7 : 0
  }
  return clamp(
    currentStockOnHand /
      (velocityUnitsPerDay * INVENTORY_HEALTH_TARGET_RUNWAY_DAYS),
    0,
    1,
  )
}

function isNewProduct(
  createdAt: string,
  newProductProtectionDays: number,
): boolean {
  const ageDays =
    (Date.now() - new Date(createdAt).getTime()) / 86_400_000
  return ageDays <= newProductProtectionDays
}

/**
 * Recent-exposure adjustment — negative for a product shown in the last
 * few days, positive ("discovery bonus") for one that hasn't been shown in
 * a while. Anchor products get this adjustment at half strength: still
 * monitored for overexposure (per the original request), just not rotated
 * out purely for having appeared recently.
 */
export function computeRotationAdjustment(
  lastFeaturedDaysAgo: number | null,
  isAnchor: boolean,
  penalty: LivePlannerConfigRow['rotation_penalty'],
): number {
  let raw: number
  if (lastFeaturedDaysAgo === null) raw = penalty.discovery14d
  else if (lastFeaturedDaysAgo <= 1) raw = penalty.day1
  else if (lastFeaturedDaysAgo === 2) raw = penalty.day2
  else if (lastFeaturedDaysAgo === 3) raw = penalty.day3
  else if (lastFeaturedDaysAgo < 7) raw = penalty.day4Plus
  else if (lastFeaturedDaysAgo < 14) raw = penalty.discovery7d
  else raw = penalty.discovery14d

  return isAnchor && raw < 0 ? raw / 2 : raw
}

/**
 * Scores one candidate for one category. `poolMaxVelocity`/`poolMaxDaysOfStock`
 * are the best values seen across the whole candidate pool being scored
 * together — velocity and days-of-stock are normalized relative to the
 * pool (not an absolute fixed scale), so the score stays meaningful as the
 * catalog's overall sales pace changes over time.
 */
export function scoreCandidate(
  candidate: ProductCandidate,
  category: LiveBasketCategory,
  config: LivePlannerConfigRow,
  pool: { maxVelocity: number; maxDaysOfStock: number },
): ScoredCandidate {
  const weights =
    category === 'seller_pick' ? null : config.scoring_weights[category]

  const daysOfStock = computeDaysOfStock(
    candidate.currentStockOnHand,
    candidate.recentVelocityUnitsPerDay,
  )
  const newProduct = isNewProduct(
    candidate.createdAt,
    config.new_product_protection_days,
  )

  const factors: ScoreFactors = {
    velocity:
      pool.maxVelocity > 0
        ? clamp(candidate.recentVelocityUnitsPerDay / pool.maxVelocity, 0, 1)
        : 0,
    inventoryHealth: inventoryHealthScore(
      candidate.currentStockOnHand,
      candidate.recentVelocityUnitsPerDay,
    ),
    sizeAvailability: candidate.sizeHealthScore,
    momentum: momentumScore(
      candidate.recentVelocityUnitsPerDay,
      candidate.priorVelocityUnitsPerDay,
    ),
    // Inventory Push wants to reward runway (the more idle days of stock,
    // the more this product needs LIVE's help moving it); every other
    // category just wants "won't stock out mid-live," which
    // inventoryHealth already captures, so daysOfStock mirrors it there
    // rather than fighting it in the opposite direction.
    daysOfStock:
      category === 'inventory_push'
        ? daysOfStock !== null && pool.maxDaysOfStock > 0
          ? clamp(daysOfStock / pool.maxDaysOfStock, 0, 1)
          : 0
        : inventoryHealthScore(
            candidate.currentStockOnHand,
            candidate.recentVelocityUnitsPerDay,
          ),
    strategicPriority:
      candidate.manualPriority || newProduct || candidate.anchorProduct
        ? 1
        : 0,
  }

  const rawScore = weights
    ? (Object.keys(weights) as Array<keyof typeof weights>).reduce(
        (sum, key) => sum + weights[key] * factors[key],
        0,
      )
    : 0

  const rotationAdjustment = computeRotationAdjustment(
    candidate.lastFeaturedDaysAgo,
    candidate.anchorProduct,
    config.rotation_penalty,
  )

  return {
    productId: candidate.productId,
    productName: candidate.productName,
    imageUrl: candidate.imageUrl,
    category,
    rawScore,
    rotationAdjustment,
    finalScore: clamp(rawScore + rotationAdjustment, 0, 100),
    factors,
    isNewProduct: newProduct,
    isAnchor: candidate.anchorProduct,
    reason: explainSelection(category, factors, newProduct, daysOfStock),
  }
}

function explainSelection(
  category: LiveBasketCategory,
  factors: ScoreFactors,
  newProduct: boolean,
  daysOfStock: number | null,
): string {
  switch (category) {
    case 'proven':
      return 'Strong recent velocity with healthy inventory and good availability across core sizes.'
    case 'priority':
      return newProduct
        ? 'Recently released — guaranteed exposure during its launch protection window.'
        : 'Marked a management priority for this shift.'
    case 'inventory_push':
      return daysOfStock !== null
        ? `Inventory is high relative to recent velocity (~${Math.round(daysOfStock)} days of stock at current pace), but still shows demonstrated sales and good size availability.`
        : 'Excess inventory relative to demand — give additional LIVE exposure.'
    case 'test':
      return factors.velocity < 0.3
        ? 'Limited LIVE exposure so far — needs more data to judge real demand.'
        : 'Uncertain conversion history — worth testing further.'
    case 'seller_pick':
      return "Selected directly by the LIVE seller's own judgment."
  }
}

/**
 * Selects `slotCount` products for one category from a qualified candidate
 * pool, using a rotation band rather than a strict top-N cut: every
 * candidate within `rotation_band_pct` of the best score is treated as
 * equally qualified, and among those, the ones with the least recent
 * exposure are preferred — this is what creates daily variety without ever
 * replacing a clearly-better product with a clearly-worse one (a score-94
 * bestseller is never displaced by a score-30 product just because the
 * weak one hasn't been shown recently).
 */
export function selectCategorySlots(
  scored: ScoredCandidate[],
  slotCount: number,
  rotationBandPct: number,
  lastFeaturedDaysAgoByProduct: Map<string, number | null>,
): ScoredCandidate[] {
  const sorted = [...scored].sort((a, b) => b.finalScore - a.finalScore)
  const selected: ScoredCandidate[] = []
  const remaining = [...sorted]

  while (selected.length < slotCount && remaining.length > 0) {
    const bestScore = remaining[0].finalScore
    const bandFloor = bestScore * (1 - rotationBandPct)
    const band = remaining.filter((c) => c.finalScore >= bandFloor)

    // Among equally-qualified candidates, prefer the one shown longest ago
    // (or never) — ties broken by score.
    band.sort((a, b) => {
      const aDays = lastFeaturedDaysAgoByProduct.get(a.productId) ?? Infinity
      const bDays = lastFeaturedDaysAgoByProduct.get(b.productId) ?? Infinity
      if (aDays !== bDays) return bDays - aDays
      return b.finalScore - a.finalScore
    })

    const chosen = band[0]
    selected.push(chosen)
    const idx = remaining.indexOf(chosen)
    remaining.splice(idx, 1)
  }

  return selected
}

export interface VarietySummary {
  newCount: number
  repeatedCount: number
  totalCount: number
  varietyScorePct: number
  sevenDayUniqueProductCount: number
  repeated: Array<{ productId: string; productName: string; reason: string }>
}

export function computeVarietySummary(
  todaysProductIds: Array<{
    productId: string
    productName: string
    isAnchor: boolean
    isNewProduct: boolean
    manualPriority: boolean
    manualLiveLock: boolean
  }>,
  yesterdayProductIds: Set<string>,
  sevenDayProductIds: Set<string>,
): VarietySummary {
  const repeated = todaysProductIds.filter((p) =>
    yesterdayProductIds.has(p.productId),
  )
  const repeatedWithReason = repeated.map((p) => ({
    productId: p.productId,
    productName: p.productName,
    reason: p.manualLiveLock
      ? 'Management priority'
      : p.isAnchor
        ? 'Anchor / strong recent performance'
        : p.isNewProduct
          ? 'New release protection'
          : p.manualPriority
            ? 'Manual priority'
            : 'Repeated — no exemption on record',
  }))
  const totalCount = todaysProductIds.length
  const newCount = totalCount - repeated.length
  return {
    newCount,
    repeatedCount: repeated.length,
    totalCount,
    varietyScorePct: totalCount > 0 ? Math.round((newCount / totalCount) * 100) : 0,
    sevenDayUniqueProductCount: sevenDayProductIds.size,
    repeated: repeatedWithReason,
  }
}

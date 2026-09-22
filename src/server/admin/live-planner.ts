/**
 * TikTok LIVE Product Planner — recommends and tracks the 12-product
 * basket for each 4-hour LIVE shift. The scoring/rotation math itself lives
 * in #/lib/live-planner/scoring.ts as pure, unit-tested functions; this
 * file's job is only to assemble their inputs from the database and
 * persist the result.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { chunkArray, fetchAllRows } from '#/lib/utils/paginate'
import { daysAgo, storeLocalDateKey, storeRangeToUtcBounds } from '#/lib/utils/date-range'
import { logStaffActivity } from './activity-log'
import {
  computeSizeHealth,
  scoreCandidate,
  selectCategorySlots,
  computeVarietySummary,
} from '#/lib/live-planner/scoring'
import type {
  ProductCandidate,
  ScoredCandidate,
  ScoreSnapshot,
} from '#/lib/live-planner/scoring'
import type {
  LiveBasketCategory,
  LivePlannerConfigRow,
  LiveReplacementReason,
  LiveShiftSlot,
} from '#/types/live-planner'
import type { StaffRole } from '#/types/entities'

const MANAGE_ROLES: StaffRole[] = ['super_admin', 'admin', 'manager']
const CONFIG_ROLES: StaffRole[] = ['super_admin', 'admin']

const SCORED_CATEGORIES: Array<Exclude<LiveBasketCategory, 'seller_pick'>> = [
  'proven',
  'priority',
  'inventory_push',
  'test',
]

const VELOCITY_WINDOW_DAYS = 30
const ORDER_ID_CHUNK_SIZE = 200
const VOID_STATUSES = new Set(['cancelled', 'failed'])

export const getLivePlannerConfig = createServerFn({ method: 'GET' }).handler(
  async (): Promise<LivePlannerConfigRow> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data, error } = await admin
      .from('live_planner_config')
      .select('*')
      .single()
    if (error) throw error
    return data
  },
)

const updateConfigSchema = z.object({
  basket_size: z.number().int().min(1).max(50).optional(),
  new_product_protection_days: z.number().int().min(0).optional(),
  max_test_appearances: z.number().int().min(1).optional(),
  min_inventory: z.number().int().min(0).optional(),
  min_size_health_score: z.number().min(0).max(1).optional(),
  max_consecutive_appearances: z.number().int().min(1).optional(),
  rotation_band_pct: z.number().min(0).max(1).optional(),
  target_new_vs_yesterday: z.number().int().min(0).optional(),
  max_daily_carryover: z.number().int().min(0).optional(),
  slot_counts: z.record(z.string(), z.number().int().min(0)).optional(),
  scoring_weights: z.record(z.string(), z.record(z.string(), z.number())).optional(),
  rotation_penalty: z.record(z.string(), z.number()).optional(),
  cooldown_days: z.record(z.string(), z.number().int().min(0)).optional(),
})

export const updateLivePlannerConfig = createServerFn({ method: 'POST' })
  .validator(updateConfigSchema)
  .handler(async ({ data }) => {
    const staff = await requireStaff(CONFIG_ROLES)
    const admin = getSupabaseAdminClient()
    const { data: current, error: currentError } = await admin
      .from('live_planner_config')
      .select('id')
      .single()
    if (currentError) throw currentError
    // The jsonb sub-shapes (slot_counts/scoring_weights/etc.) are validated
    // by the zod schema above but come out as plain Record<string, ...>,
    // which the hand-written Update type's narrower keyed records reject —
    // same friction as any jsonb column update elsewhere in this app.
    const { error } = await admin
      .from('live_planner_config')
      .update({
        ...data,
        updated_at: new Date().toISOString(),
      } as Partial<LivePlannerConfigRow>)
      .eq('id', current.id)
    if (error) throw error
    await logStaffActivity(staff, 'live_planner.update_config', 'live_planner_config', current.id, data)
  })

export const setProductLiveFlags = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      productId: z.string().uuid(),
      liveEligible: z.boolean().optional(),
      manualLiveLock: z.boolean().optional(),
      manualPriority: z.boolean().optional(),
      anchorProduct: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()
    const { error } = await admin.from('product_live_flags').upsert(
      {
        product_id: data.productId,
        ...(data.liveEligible !== undefined && { live_eligible: data.liveEligible }),
        ...(data.manualLiveLock !== undefined && { manual_live_lock: data.manualLiveLock }),
        ...(data.manualPriority !== undefined && { manual_priority: data.manualPriority }),
        ...(data.anchorProduct !== undefined && { anchor_product: data.anchorProduct }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'product_id' },
    )
    if (error) throw error
    await logStaffActivity(staff, 'live_planner.set_product_flags', 'products', data.productId, data)
  })

export interface LiveBasketItemView {
  id: string
  productId: string
  productName: string
  imageUrl: string | null
  category: LiveBasketCategory
  recommendedOrder: number
  currentStockOnHand: number
  scoreSnapshot: ScoreSnapshot | null
  repeatedFromYesterday: boolean
  repeatReason: string | null
  isReplacement: boolean
  originalProductId: string | null
  replacementReason: LiveReplacementReason | null
  pinStart: string | null
  pinEnd: string | null
}

export interface LiveShiftView {
  id: string
  liveDate: string
  shift: LiveShiftSlot
  status: 'draft' | 'finalized' | 'live' | 'completed'
  items: LiveBasketItemView[]
  varietySummary: ReturnType<typeof computeVarietySummary> | null
}

const AUTO_CATEGORIES_SLOT_COUNT = 11 // 12 minus the manually-added seller pick

/**
 * Every input the scoring engine needs for every currently-active,
 * live-eligible product, assembled from products/product_variants/
 * inventory/order_items/product_live_flags in as few round trips as
 * practical — mirrors the batching/chunking conventions already
 * established in server/admin/analytics.ts (fetchAllRows + chunkArray for
 * anything keyed by a potentially-large id list).
 */
async function buildCandidatePool(
  admin: ReturnType<typeof getSupabaseAdminClient>,
): Promise<{
  candidates: ProductCandidate[]
  sizeHealthByProduct: Map<string, number>
}> {
  const products = await fetchAllRows((offset) =>
    admin
      .from('products')
      .select(
        'id, name, images, created_at, variants:product_variants(id, is_active, inventory(quantity_on_hand, quantity_available))',
      )
      .eq('status', 'active')
      .range(offset, offset + 999),
  )

  const flagRows = await fetchAllRows((offset) =>
    admin.from('product_live_flags').select('*').range(offset, offset + 999),
  )
  const flagsByProduct = new Map(flagRows.map((f) => [f.product_id, f]))

  const variantToProduct = new Map<string, string>()
  const stockByProduct = new Map<string, number>()
  const variantsByProduct = new Map<
    string,
    Array<{ variantId: string; quantityAvailable: number }>
  >()
  for (const product of products) {
    let stock = 0
    const variants: Array<{ variantId: string; quantityAvailable: number }> = []
    for (const variant of product.variants) {
      if (!variant.is_active) continue
      variantToProduct.set(variant.id, product.id)
      for (const inv of variant.inventory) stock += inv.quantity_on_hand
      const available = variant.inventory.reduce(
        (sum, inv) => sum + inv.quantity_available,
        0,
      )
      variants.push({ variantId: variant.id, quantityAvailable: available })
    }
    stockByProduct.set(product.id, stock)
    variantsByProduct.set(product.id, variants)
  }
  // Units sold, bucketed by (variantId, store-local day) — one 30-day
  // fetch covers the recent-vs-prior-week velocity comparison AND the
  // per-variant historical-sales-share size-health weighting.
  const today = daysAgo(0)
  const windowStartDay = daysAgo(VELOCITY_WINDOW_DAYS)
  const { start: windowStart, end: windowEnd } = storeRangeToUtcBounds(
    windowStartDay,
    today,
  )
  const orders = await fetchAllRows((query) =>
    admin
      .from('orders')
      .select('id, placed_at, status')
      .gte('placed_at', windowStart)
      .lte('placed_at', windowEnd)
      .range(query, query + 999),
  )
  const liveOrders = orders.filter((o) => !VOID_STATUSES.has(o.status))
  const dayByOrderId = new Map(
    liveOrders.map((o) => [o.id, storeLocalDateKey(o.placed_at)]),
  )
  const liveOrderIds = liveOrders.map((o) => o.id)

  const unitsByVariantAndDay = new Map<string, Map<string, number>>()
  if (liveOrderIds.length > 0) {
    const itemChunks = await Promise.all(
      chunkArray(liveOrderIds, ORDER_ID_CHUNK_SIZE).map((ids) =>
        fetchAllRows((offset) =>
          admin
            .from('order_items')
            .select('order_id, variant_id, quantity')
            .in('order_id', ids)
            .range(offset, offset + 999),
        ),
      ),
    )
    for (const item of itemChunks.flat()) {
      if (!item.variant_id) continue
      const dayKey = dayByOrderId.get(item.order_id)
      if (!dayKey) continue
      const byDay = unitsByVariantAndDay.get(item.variant_id) ?? new Map()
      byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + item.quantity)
      unitsByVariantAndDay.set(item.variant_id, byDay)
    }
  }

  function unitsInWindow(variantId: string, fromDaysAgo: number, toDaysAgo: number): number {
    const byDay = unitsByVariantAndDay.get(variantId)
    if (!byDay) return 0
    let sum = 0
    for (let n = toDaysAgo; n <= fromDaysAgo; n++) sum += byDay.get(daysAgo(n)) ?? 0
    return sum
  }

  const sizeHealthByProduct = new Map<string, number>()
  const candidates: ProductCandidate[] = []
  for (const product of products) {
    const variants = variantsByProduct.get(product.id) ?? []
    const sizeHealthScore = computeSizeHealth(
      variants.map((v) => ({
        quantityAvailable: v.quantityAvailable,
        historicalUnitsSold: unitsInWindow(v.variantId, VELOCITY_WINDOW_DAYS, 1),
      })),
    )
    sizeHealthByProduct.set(product.id, sizeHealthScore)

    const recentUnits = variants.reduce(
      (sum, v) => sum + unitsInWindow(v.variantId, 7, 1),
      0,
    )
    const priorUnits = variants.reduce(
      (sum, v) => sum + unitsInWindow(v.variantId, 14, 8),
      0,
    )

    const flags = flagsByProduct.get(product.id)
    candidates.push({
      productId: product.id,
      productName: product.name,
      imageUrl: product.images[0] ?? null,
      createdAt: product.created_at,
      currentStockOnHand: stockByProduct.get(product.id) ?? 0,
      recentVelocityUnitsPerDay: recentUnits / 7,
      priorVelocityUnitsPerDay: priorUnits / 7,
      sizeHealthScore,
      liveEligible: flags?.live_eligible ?? true,
      manualLiveLock: flags?.manual_live_lock ?? false,
      manualPriority: flags?.manual_priority ?? false,
      anchorProduct: flags?.anchor_product ?? false,
      lastFeaturedDaysAgo: null, // filled in by the caller from basket history
      consecutiveDaysFeatured: 0, // filled in by the caller from basket history
      testAppearanceCount: 0, // filled in by the caller from basket history
    })
  }

  return { candidates, sizeHealthByProduct }
}

interface ExposureHistory {
  lastFeaturedDaysAgoByProduct: Map<string, number>
  consecutiveDaysByProduct: Map<string, number>
  testAppearanceCountByProduct: Map<string, number>
  lastFeaturedInCategoryDaysAgo: Map<string, Map<LiveBasketCategory, number>>
  yesterdayProductIds: Set<string>
  sevenDayProductIds: Set<string>
}

/** 90 days of history is enough to cover consecutive-day streaks and the
 *  7/14-day recency bands the rotation penalty uses. */
async function loadExposureHistory(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  liveDate: string,
): Promise<ExposureHistory> {
  const since = new Date(liveDate)
  since.setDate(since.getDate() - 90)
  const sinceDateStr = since.toISOString().slice(0, 10)

  // Two flat queries + an in-memory join, not an embedded relation select —
  // live_shifts/live_basket_items have no declared FK Relationships in the
  // hand-written database.types.ts (same constraint documented elsewhere
  // in this codebase, e.g. creators.ts's tables), which breaks Supabase's
  // embedded-select type inference.
  const shiftRows = await fetchAllRows((offset) =>
    admin
      .from('live_shifts')
      .select('id, live_date')
      .gte('live_date', sinceDateStr)
      .lt('live_date', liveDate)
      .in('status', ['finalized', 'live', 'completed'])
      .range(offset, offset + 999),
  )
  const liveDateByShiftId = new Map(shiftRows.map((s) => [s.id, s.live_date]))
  const shiftIds = shiftRows.map((s) => s.id)

  const itemRows =
    shiftIds.length === 0
      ? []
      : (
          await Promise.all(
            chunkArray(shiftIds, ORDER_ID_CHUNK_SIZE).map((ids) =>
              fetchAllRows((offset) =>
                admin
                  .from('live_basket_items')
                  .select('shift_id, product_id, category')
                  .in('shift_id', ids)
                  .range(offset, offset + 999),
              ),
            ),
          )
        ).flat()

  const rows = itemRows.map((row) => ({
    product_id: row.product_id,
    category: row.category,
    live_date: liveDateByShiftId.get(row.shift_id)!,
  }))

  const yesterday = new Date(liveDate)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().slice(0, 10)
  const sevenDaysAgo = new Date(liveDate)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10)

  const datesByProduct = new Map<string, Set<string>>()
  const categoryDatesByProduct = new Map<
    string,
    Map<LiveBasketCategory, Set<string>>
  >()
  const testAppearanceCountByProduct = new Map<string, number>()
  const yesterdayProductIds = new Set<string>()
  const sevenDayProductIds = new Set<string>()

  for (const row of rows) {
    const liveDateOfRow = row.live_date
    const dates = datesByProduct.get(row.product_id) ?? new Set()
    dates.add(liveDateOfRow)
    datesByProduct.set(row.product_id, dates)

    const byCategory =
      categoryDatesByProduct.get(row.product_id) ?? new Map()
    const catDates = byCategory.get(row.category) ?? new Set()
    catDates.add(liveDateOfRow)
    byCategory.set(row.category, catDates)
    categoryDatesByProduct.set(row.product_id, byCategory)

    if (row.category === 'test') {
      testAppearanceCountByProduct.set(
        row.product_id,
        (testAppearanceCountByProduct.get(row.product_id) ?? 0) + 1,
      )
    }
    if (liveDateOfRow === yesterdayStr) yesterdayProductIds.add(row.product_id)
    if (liveDateOfRow >= sevenDaysAgoStr) sevenDayProductIds.add(row.product_id)
  }

  const lastFeaturedDaysAgoByProduct = new Map<string, number>()
  const consecutiveDaysByProduct = new Map<string, number>()
  const target = new Date(liveDate)
  for (const [productId, dates] of datesByProduct) {
    const sortedDates = Array.from(dates).sort().reverse()
    const mostRecent = new Date(sortedDates[0])
    const daysAgoCount = Math.round(
      (target.getTime() - mostRecent.getTime()) / 86_400_000,
    )
    lastFeaturedDaysAgoByProduct.set(productId, daysAgoCount)

    let streak = 0
    const cursor = new Date(target)
    cursor.setDate(cursor.getDate() - 1)
    while (dates.has(cursor.toISOString().slice(0, 10))) {
      streak += 1
      cursor.setDate(cursor.getDate() - 1)
    }
    consecutiveDaysByProduct.set(productId, streak)
  }

  const lastFeaturedInCategoryDaysAgo = new Map<
    string,
    Map<LiveBasketCategory, number>
  >()
  for (const [productId, byCategory] of categoryDatesByProduct) {
    const perCategory = new Map<LiveBasketCategory, number>()
    for (const [category, dates] of byCategory) {
      const mostRecent = new Date(Array.from(dates).sort().reverse()[0])
      perCategory.set(
        category,
        Math.round((target.getTime() - mostRecent.getTime()) / 86_400_000),
      )
    }
    lastFeaturedInCategoryDaysAgo.set(productId, perCategory)
  }

  return {
    lastFeaturedDaysAgoByProduct,
    consecutiveDaysByProduct,
    testAppearanceCountByProduct,
    lastFeaturedInCategoryDaysAgo,
    yesterdayProductIds,
    sevenDayProductIds,
  }
}

export const generateBasket = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      liveDate: z.string(),
      shift: z.enum(['10am_2pm', '6pm_10pm', '10pm_2am']),
    }),
  )
  .handler(async ({ data }): Promise<LiveShiftView> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: config, error: configError } = await admin
      .from('live_planner_config')
      .select('*')
      .single()
    if (configError) throw configError

    const [{ candidates }, history] = await Promise.all([
      buildCandidatePool(admin),
      loadExposureHistory(admin, data.liveDate),
    ])

    for (const c of candidates) {
      c.lastFeaturedDaysAgo =
        history.lastFeaturedDaysAgoByProduct.get(c.productId) ?? null
      c.consecutiveDaysFeatured =
        history.consecutiveDaysByProduct.get(c.productId) ?? 0
      c.testAppearanceCount =
        history.testAppearanceCountByProduct.get(c.productId) ?? 0
    }

    // Hard eligibility — a locked product bypasses everything except
    // live_eligible=false (staff can still hard-block a product outright).
    const eligible = candidates.filter((c) => {
      if (!c.liveEligible) return false
      if (c.manualLiveLock) return true
      if (c.currentStockOnHand < config.min_inventory) return false
      if (c.sizeHealthScore < config.min_size_health_score) return false
      if (
        c.consecutiveDaysFeatured >= config.max_consecutive_appearances &&
        !c.anchorProduct &&
        !c.manualPriority
      ) {
        return false
      }
      return true
    })

    const locked = eligible.filter((c) => c.manualLiveLock)
    const scoreable = eligible.filter((c) => !c.manualLiveLock)

    const poolMaxVelocity = Math.max(
      1,
      ...scoreable.map((c) => c.recentVelocityUnitsPerDay),
    )
    const poolMaxDaysOfStock = Math.max(
      1,
      ...scoreable.map((c) =>
        c.recentVelocityUnitsPerDay > 0
          ? c.currentStockOnHand / c.recentVelocityUnitsPerDay
          : 0,
      ),
    )
    const pool = { maxVelocity: poolMaxVelocity, maxDaysOfStock: poolMaxDaysOfStock }

    const slotCounts = config.slot_counts
    const selectedByCategory = new Map<LiveBasketCategory, ScoredCandidate[]>()
    const usedProductIds = new Set<string>()

    // Locked-in products consume their best-fit category's slots first,
    // ahead of scored competition, tagged with why they were force-included.
    for (const category of SCORED_CATEGORIES) {
      const lockedForCategory = locked
        .filter((c) => !usedProductIds.has(c.productId))
        .map((c) => scoreCandidate(c, category, config, pool))
        .sort((a, b) => b.finalScore - a.finalScore)
      const slotsRemaining = slotCounts[category]
      const take = lockedForCategory.slice(0, slotsRemaining).map((s) => ({
        ...s,
        reason: 'Management locked — always included in this LIVE.',
      }))
      selectedByCategory.set(category, take)
      for (const s of take) usedProductIds.add(s.productId)
    }

    for (const category of SCORED_CATEGORIES) {
      const alreadySelected = selectedByCategory.get(category) ?? []
      const slotsRemaining = slotCounts[category] - alreadySelected.length
      if (slotsRemaining <= 0) continue

      const cooldownDays = config.cooldown_days[category]
      const candidatesForCategory = scoreable.filter((c) => {
        if (usedProductIds.has(c.productId)) return false
        if (category === 'test' && c.testAppearanceCount >= config.max_test_appearances) {
          return false
        }
        const lastInCategory = history.lastFeaturedInCategoryDaysAgo
          .get(c.productId)
          ?.get(category)
        if (lastInCategory !== undefined && lastInCategory < cooldownDays) return false
        return true
      })

      const scored = candidatesForCategory.map((c) =>
        scoreCandidate(c, category, config, pool),
      )
      const chosen = selectCategorySlots(
        scored,
        slotsRemaining,
        config.rotation_band_pct,
        history.lastFeaturedDaysAgoByProduct,
      )
      selectedByCategory.set(category, [...alreadySelected, ...chosen])
      for (const s of chosen) usedProductIds.add(s.productId)
    }

    // Interleave categories rather than grouping all of one category
    // together — proven/new/inventory-push/test mixed throughout the shift,
    // per the "don't group all four bestsellers together" requirement.
    const interleaved: ScoredCandidate[] = []
    const queues = SCORED_CATEGORIES.map((cat) => [
      ...(selectedByCategory.get(cat) ?? []),
    ])
    let cursor = 0
    while (interleaved.length < AUTO_CATEGORIES_SLOT_COUNT) {
      const queue = queues[cursor % queues.length]
      if (queue.length > 0) interleaved.push(queue.shift()!)
      cursor += 1
      if (queues.every((q) => q.length === 0)) break
    }

    // Upsert the shift row (unique on live_date+shift — regenerating an
    // existing draft just resets it rather than creating a duplicate).
    const { data: shiftRow, error: shiftError } = await admin
      .from('live_shifts')
      .upsert(
        {
          live_date: data.liveDate,
          shift: data.shift,
          status: 'draft',
          created_by: staff.id,
        },
        { onConflict: 'live_date,shift' },
      )
      .select('*')
      .single()
    if (shiftError) throw shiftError

    // Regenerating replaces every non-seller-pick item; the seller pick (if
    // already chosen) survives a regenerate since it's a human decision,
    // not part of the algorithm's own output.
    const { error: deleteError } = await admin
      .from('live_basket_items')
      .delete()
      .eq('shift_id', shiftRow.id)
      .neq('category', 'seller_pick')
    if (deleteError) throw deleteError

    const itemsToInsert = interleaved.map((s, index) => ({
      shift_id: shiftRow.id,
      product_id: s.productId,
      category: s.category,
      recommended_order: index + 1,
      score_snapshot: {
        rawScore: s.rawScore,
        rotationAdjustment: s.rotationAdjustment,
        finalScore: s.finalScore,
        factors: s.factors,
        reason: s.reason,
      },
      repeated_from_yesterday: history.yesterdayProductIds.has(s.productId),
      repeat_reason: history.yesterdayProductIds.has(s.productId)
        ? s.isAnchor
          ? 'Anchor / strong recent performance'
          : s.isNewProduct
            ? 'New release protection'
            : 'Repeated — no exemption on record'
        : null,
    }))

    const { error: insertError } = await admin
      .from('live_basket_items')
      .insert(itemsToInsert)
    if (insertError) throw insertError

    await logStaffActivity(staff, 'live_planner.generate_basket', 'live_shifts', shiftRow.id, {
      liveDate: data.liveDate,
      shift: data.shift,
      itemCount: itemsToInsert.length,
    })

    return getShiftView(admin, shiftRow.id)
  })

async function getShiftView(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  shiftId: string,
): Promise<LiveShiftView> {
  const { data: shift, error: shiftError } = await admin
    .from('live_shifts')
    .select('*')
    .eq('id', shiftId)
    .single()
  if (shiftError) throw shiftError

  // Flat query, no embedded product/stock select — same Relationships
  // constraint as loadExposureHistory above; products/stock are fetched
  // separately below and joined in memory.
  const { data: itemRows, error: itemsError } = await admin
    .from('live_basket_items')
    .select(
      'id, product_id, category, recommended_order, score_snapshot, repeated_from_yesterday, repeat_reason, is_replacement, original_product_id, replacement_reason, pin_start, pin_end',
    )
    .eq('shift_id', shiftId)
    .order('recommended_order', { ascending: true })
  if (itemsError) throw itemsError

  const productIds = Array.from(new Set(itemRows.map((r) => r.product_id)))
  const products =
    productIds.length === 0
      ? []
      : await fetchAllRows((offset) =>
          admin
            .from('products')
            .select(
              'id, name, images, variants:product_variants(inventory(quantity_on_hand))',
            )
            .in('id', productIds)
            .range(offset, offset + 999),
        )
  const productById = new Map(products.map((p) => [p.id, p]))

  const items: LiveBasketItemView[] = itemRows.map((row) => {
    const product = productById.get(row.product_id)
    return {
      id: row.id,
      productId: row.product_id,
      productName: product?.name ?? '(deleted product)',
      imageUrl: product?.images[0] ?? null,
      category: row.category,
      recommendedOrder: row.recommended_order,
      currentStockOnHand:
        product?.variants.reduce(
          (sum, v) =>
            sum + v.inventory.reduce((s, inv) => s + inv.quantity_on_hand, 0),
          0,
        ) ?? 0,
      scoreSnapshot: row.score_snapshot as ScoreSnapshot | null,
      repeatedFromYesterday: row.repeated_from_yesterday,
      repeatReason: row.repeat_reason,
      isReplacement: row.is_replacement,
      originalProductId: row.original_product_id,
      replacementReason: row.replacement_reason,
      pinStart: row.pin_start,
      pinEnd: row.pin_end,
    }
  })

  let varietySummary: ReturnType<typeof computeVarietySummary> | null = null
  if (items.length > 0) {
    const history = await loadExposureHistory(admin, shift.live_date)
    varietySummary = computeVarietySummary(
      items.map((i) => ({
        productId: i.productId,
        productName: i.productName,
        isAnchor: i.repeatReason === 'Anchor / strong recent performance',
        isNewProduct: i.repeatReason === 'New release protection',
        manualPriority: false,
        manualLiveLock: i.repeatReason?.startsWith('Management') ?? false,
      })),
      history.yesterdayProductIds,
      history.sevenDayProductIds,
    )
  }

  return {
    id: shift.id,
    liveDate: shift.live_date,
    shift: shift.shift,
    status: shift.status,
    items,
    varietySummary,
  }
}

export const getShift = createServerFn({ method: 'GET' })
  .validator(z.object({ liveDate: z.string(), shift: z.enum(['10am_2pm', '6pm_10pm', '10pm_2am']) }))
  .handler(async ({ data }): Promise<LiveShiftView | null> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data: shiftRow, error } = await admin
      .from('live_shifts')
      .select('id')
      .eq('live_date', data.liveDate)
      .eq('shift', data.shift)
      .maybeSingle()
    if (error) throw error
    if (!shiftRow) return null
    return getShiftView(admin, shiftRow.id)
  })

export const listTodaysShifts = createServerFn({ method: 'GET' })
  .validator(z.object({ liveDate: z.string() }))
  .handler(async ({ data }): Promise<
    Array<{ shift: LiveShiftSlot; status: string | null; itemCount: number }>
  > => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data: shiftRows, error } = await admin
      .from('live_shifts')
      .select('id, shift, status')
      .eq('live_date', data.liveDate)
    if (error) throw error

    const shiftIds = shiftRows.map((s) => s.id)
    const { data: itemRows, error: itemsError } =
      shiftIds.length === 0
        ? { data: [], error: null }
        : await admin
            .from('live_basket_items')
            .select('shift_id')
            .in('shift_id', shiftIds)
    if (itemsError) throw itemsError
    const itemCountByShiftId = new Map<string, number>()
    for (const item of itemRows) {
      itemCountByShiftId.set(
        item.shift_id,
        (itemCountByShiftId.get(item.shift_id) ?? 0) + 1,
      )
    }

    const byShift = new Map(shiftRows.map((r) => [r.shift, r]))
    const allShifts: LiveShiftSlot[] = ['10am_2pm', '6pm_10pm', '10pm_2am']
    return allShifts.map((shift) => {
      const row = byShift.get(shift)
      return {
        shift,
        status: row?.status ?? null,
        itemCount: row ? (itemCountByShiftId.get(row.id) ?? 0) : 0,
      }
    })
  })

export const setSellerPick = createServerFn({ method: 'POST' })
  .validator(z.object({ shiftId: z.string().uuid(), productId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()
    const { error: deleteError } = await admin
      .from('live_basket_items')
      .delete()
      .eq('shift_id', data.shiftId)
      .eq('category', 'seller_pick')
    if (deleteError) throw deleteError
    const { error } = await admin.from('live_basket_items').insert({
      shift_id: data.shiftId,
      product_id: data.productId,
      category: 'seller_pick',
      recommended_order: AUTO_CATEGORIES_SLOT_COUNT + 1,
    })
    if (error) throw error
    await logStaffActivity(staff, 'live_planner.set_seller_pick', 'live_shifts', data.shiftId, {
      productId: data.productId,
    })
  })

export const replaceBasketItem = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      itemId: z.string().uuid(),
      replacementProductId: z.string().uuid(),
      reason: z.enum([
        'viewer_request',
        'low_engagement',
        'product_sold_out',
        'size_sold_out',
        'seller_judgment',
        'management_request',
        'other',
      ]),
    }),
  )
  .handler(async ({ data }) => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()
    const { data: existing, error: existingError } = await admin
      .from('live_basket_items')
      .select('product_id, original_product_id')
      .eq('id', data.itemId)
      .single()
    if (existingError) throw existingError

    const { error } = await admin
      .from('live_basket_items')
      .update({
        product_id: data.replacementProductId,
        original_product_id: existing.original_product_id ?? existing.product_id,
        is_replacement: true,
        replacement_reason: data.reason,
        replaced_by: staff.id,
        replaced_at: new Date().toISOString(),
      })
      .eq('id', data.itemId)
    if (error) throw error
    await logStaffActivity(staff, 'live_planner.replace_item', 'live_basket_items', data.itemId, data)
  })

export const finalizeShift = createServerFn({ method: 'POST' })
  .validator(z.object({ shiftId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()
    const { error } = await admin
      .from('live_shifts')
      .update({ status: 'finalized', finalized_by: staff.id, updated_at: new Date().toISOString() })
      .eq('id', data.shiftId)
    if (error) throw error
    await logStaffActivity(staff, 'live_planner.finalize_shift', 'live_shifts', data.shiftId, {})
  })

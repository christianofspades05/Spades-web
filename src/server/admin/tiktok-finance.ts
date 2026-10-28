/**
 * Whole-shop TikTok Shop finance summary — deliberately not per-order (see
 * tiktok-shop/adapter.ts's getTikTokFinanceStatements doc comment for why
 * this isn't shaped like Shopee's per-order platform-fee reconciliation).
 * Powers src/routes/admin/analytics/tiktok-finance.tsx.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { storeRangeToUtcBounds } from '#/lib/utils/date-range'
import { createTtlCache } from '#/lib/utils/cache'
import { ensureFreshConnection } from '#/server/integrations/marketplaces/sync-engine'
import { getTikTokFinanceStatements } from '#/server/integrations/marketplaces/tiktok-shop/adapter'
import type { TikTokFinanceStatement } from '#/server/integrations/marketplaces/tiktok-shop/adapter'

// Same 2-minute reasoning as analytics.ts's ANALYTICS_CACHE_TTL_MS — short
// enough that a staff member refreshing the page after a real change sees
// it soon, long enough that repeat page loads/polls don't hit TikTok's API
// every time.
const FINANCE_CACHE_TTL_MS = 2 * 60_000
const financeSummaryCache = createTtlCache<TikTokFinanceSummary>(
  FINANCE_CACHE_TTL_MS,
)

export interface TikTokFinanceSummary {
  connected: boolean
  range: { from: string; to: string }
  totals: {
    revenueCents: number
    feeCents: number
    adjustmentCents: number
    settlementCents: number
    shippingCostCents: number
    netSalesCents: number
  }
  statements: (TikTokFinanceStatement & { date: string })[]
}

const EMPTY_TOTALS = {
  revenueCents: 0,
  feeCents: 0,
  adjustmentCents: 0,
  settlementCents: 0,
  shippingCostCents: 0,
  netSalesCents: 0,
}

export const getTikTokFinanceSummary = createServerFn({ method: 'GET' })
  .validator(z.object({ from: z.string(), to: z.string() }))
  .handler(async ({ data }): Promise<TikTokFinanceSummary> => {
    await requireStaff()

    const cacheKey = `${data.from}|${data.to}`
    const cached = financeSummaryCache.get(cacheKey)
    if (cached) return cached

    const admin = getSupabaseAdminClient()
    const { data: connection, error } = await admin
      .from('marketplace_connections')
      .select('*')
      .eq('marketplace', 'tiktok_shop')
      .eq('status', 'active')
      .maybeSingle()
    if (error) throw error

    if (!connection) {
      return {
        connected: false,
        range: data,
        totals: EMPTY_TOTALS,
        statements: [],
      }
    }

    const fresh = await ensureFreshConnection(connection)
    const { start, end } = storeRangeToUtcBounds(data.from, data.to)
    const statements = await getTikTokFinanceStatements(fresh, {
      sinceSeconds: Math.floor(new Date(start).getTime() / 1000),
      untilSeconds: Math.floor(new Date(end).getTime() / 1000),
    })

    const totals = statements.reduce(
      (sum, s) => ({
        revenueCents: sum.revenueCents + s.revenueCents,
        feeCents: sum.feeCents + s.feeCents,
        adjustmentCents: sum.adjustmentCents + s.adjustmentCents,
        settlementCents: sum.settlementCents + s.settlementCents,
        shippingCostCents: sum.shippingCostCents + s.shippingCostCents,
        netSalesCents: sum.netSalesCents + s.netSalesCents,
      }),
      { ...EMPTY_TOTALS },
    )

    const result: TikTokFinanceSummary = {
      connected: true,
      range: data,
      totals,
      statements: statements
        .map((s) => ({
          ...s,
          date: new Date(s.statementTimeSec * 1000).toISOString().slice(0, 10),
        }))
        .sort((a, b) => b.statementTimeSec - a.statementTimeSec),
    }
    financeSummaryCache.set(cacheKey, result)
    return result
  })

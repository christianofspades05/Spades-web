/**
 * Admin "Ads Efficiency" page: ROAS and cost per purchase, in two shapes —
 * `totals` is blended across every sales channel (Storefront, TikTok Shop,
 * Shopee, Lazada) against total Meta ad spend, answering "given what I
 * spent on ads, how is the whole store doing" without claiming any one
 * order came from an ad (a small store can't attribute every marketplace
 * sale back to a specific ad). `attributedTotals` is the narrower, more
 * literal "did this ad spend actually work" figure: first-click Facebook
 * attribution (fbclid captured on landing — storefront only, see
 * getFacebookAdsSales in analytics.ts for the underlying query), so only
 * orders that can actually be traced back to a Facebook ad click count.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { previousPeriod } from '#/lib/utils/date-range'
import { getMetaAdSpendCents } from '#/server/integrations/windsor/client'
import { getSalesByChannel, getFacebookAdsSales } from './analytics'

export interface AdsEfficiencyTotals {
  adsSpendCents: number
  grossSalesCents: number
  orderCount: number
  /** Gross sales ÷ ad spend. Null when ad spend was 0 in range — not a
   *  real 0x, undefined (nothing to divide by). */
  roas: number | null
  /** Ad spend ÷ orders. Null when there were no orders in range — ad
   *  spend against zero purchases isn't a real cost-per-purchase figure. */
  costPerPurchaseCents: number | null
}

export interface AdsEfficiencyResult {
  range: { from: string; to: string }
  totals: AdsEfficiencyTotals
  previousTotals: AdsEfficiencyTotals | null
  attributedTotals: AdsEfficiencyTotals
  previousAttributedTotals: AdsEfficiencyTotals | null
}

function computeTotals(
  adsSpendCents: number,
  grossSalesCents: number,
  orderCount: number,
): AdsEfficiencyTotals {
  return {
    adsSpendCents,
    grossSalesCents,
    orderCount,
    roas: adsSpendCents > 0 ? grossSalesCents / adsSpendCents : null,
    costPerPurchaseCents:
      orderCount > 0 ? Math.round(adsSpendCents / orderCount) : null,
  }
}

export const getAdsEfficiency = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      from: z.string(),
      to: z.string(),
      brand: z.string().optional(),
      comparePrevious: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }): Promise<AdsEfficiencyResult> => {
    await requireStaff()

    const prev = data.comparePrevious ? previousPeriod(data.from, data.to) : null

    const [adsSpendCents, sales, fbSales, prevAdsSpendCents, prevSales] =
      await Promise.all([
        getMetaAdSpendCents({ from: data.from, to: data.to }),
        getSalesByChannel({
          data: { from: data.from, to: data.to, brand: data.brand },
        }),
        getFacebookAdsSales({
          data: {
            from: data.from,
            to: data.to,
            brand: data.brand,
            comparePrevious: data.comparePrevious,
          },
        }),
        prev
          ? getMetaAdSpendCents({ from: prev.from, to: prev.to })
          : Promise.resolve(null),
        prev
          ? getSalesByChannel({
              data: { from: prev.from, to: prev.to, brand: data.brand },
            })
          : Promise.resolve(null),
      ])

    const totals = computeTotals(
      adsSpendCents,
      sales.totals.grossSalesCents,
      sales.totals.orderCount,
    )
    const previousTotals =
      prevAdsSpendCents !== null && prevSales
        ? computeTotals(
            prevAdsSpendCents,
            prevSales.totals.grossSalesCents,
            prevSales.totals.orderCount,
          )
        : null

    const attributedTotals = computeTotals(
      adsSpendCents,
      fbSales.totals.grossSalesCents,
      fbSales.totals.orderCount,
    )
    const previousAttributedTotals =
      prevAdsSpendCents !== null && fbSales.previousTotals
        ? computeTotals(
            prevAdsSpendCents,
            fbSales.previousTotals.grossSalesCents,
            fbSales.previousTotals.orderCount,
          )
        : null

    return {
      range: { from: data.from, to: data.to },
      totals,
      previousTotals,
      attributedTotals,
      previousAttributedTotals,
    }
  })

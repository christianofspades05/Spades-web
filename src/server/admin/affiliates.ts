import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { reportRangeToUtcBounds } from '#/lib/utils/date-range'
import {
  AFFILIATE_STATUS_RULES,
  affiliateStatus,
  daysSince,
  roiOf,
} from '#/lib/creators/affiliate-status'
import type { AffiliateStatus } from '#/lib/creators/affiliate-status'

/**
 * Creators & Affiliates → Analytics. Thin wrappers around the SQL functions from
 * migration 0137 (creator_performance / creator_detail), which do the
 * money math in one place — see that migration's header for the formulas
 * and why they match the Profit page.
 */

const ROLES = ['super_admin', 'admin', 'manager'] as const
async function authorize() {
  const staff = await requireStaff([...ROLES])
  setResponseHeader('Cache-Control', 'no-store')
  return staff
}

const TZ_IANA = { ph: 'Asia/Manila', la: 'America/Los_Angeles' } as const

/** Where each brand's creator links point. */
export const BRAND_STORE_URL: Record<string, string> = {
  spades: 'https://spades-official.com',
  ysrael: 'https://ysraelbrand.com',
  aspire365: 'https://aspire365.co',
}

export function creatorLink(code: string, brand: string): string {
  const base = BRAND_STORE_URL[brand] ?? BRAND_STORE_URL.spades
  return `${base}/?ref=${encodeURIComponent(code)}`
}

const rangeSchema = z.object({
  /** Omit both for all time. */
  from: z.string().optional(),
  to: z.string().optional(),
  tz: z.enum(['ph', 'la']).default('ph'),
})

function rangeBounds(data: z.infer<typeof rangeSchema>) {
  if (!data.from || !data.to) return { start: null, end: null }
  return reportRangeToUtcBounds(data.from, data.to, data.tz)
}

interface PerformanceRow {
  creator_id: string
  name: string
  is_active: boolean
  tiktok_url: string | null
  instagram_url: string | null
  facebook_url: string | null
  codes: string[]
  code_brands: string[]
  has_active_code: boolean
  gifts_cents: number
  content_fees_cents: number
  other_expenses_cents: number
  commission_earned_cents: number
  attributed_orders: number
  orders: number
  code_orders: number
  link_orders: number
  cancel_return_orders: number
  net_sales_cents: number
  cogs_cents: number
  order_profit_cents: number
  new_customer_orders: number
  link_clicks: number
  last_order_at: string | null
  last_gift_at: string | null
  orders_since_last_gift: number
  lifetime_expenses_cents: number
  commission_eligible_cents: number
  commission_on_hold_cents: number
  profit_60d_cents: number
  spent_60d_cents: number
}

export interface AffiliateRow {
  creatorId: string
  name: string
  isActive: boolean
  tiktokUrl: string | null
  instagramUrl: string | null
  facebookUrl: string | null
  codes: { code: string; brand: string; link: string }[]
  status: AffiliateStatus
  spentCents: number
  giftsCents: number
  feesCents: number
  otherExpensesCents: number
  commissionEarnedCents: number
  linkClicks: number
  /** Non-cancelled, non-returned attributed orders. */
  orders: number
  codeOrders: number
  linkOrders: number
  attributedOrders: number
  cancelReturnPct: number | null
  netSalesCents: number
  cogsCents: number
  /** Σ order profit (Profit page formula) before creator costs. */
  orderProfitCents: number
  /** orderProfit − commission − gifts/fees/other. */
  profitCents: number
  roi: number | null
  costPerOrderCents: number | null
  aovCents: number | null
  newCustomerPct: number | null
  clickToOrderPct: number | null
  lastOrderAt: string | null
  lastGiftAt: string | null
  daysSinceLastGift: number | null
  ordersSinceLastGift: number
  commissionOwedCents: number
  commissionEligibleCents: number
  commissionOnHoldCents: number
}

export interface AffiliateAlert {
  kind: 'no_code' | 'no_orders_after_gift' | 'scale' | 'payout_ready'
  creatorId: string
  creatorName: string
  message: string
}

export interface AffiliateSummary {
  spentCents: number
  giftsCents: number
  feesCents: number
  otherExpensesCents: number
  commissionEarnedCents: number
  orders: number
  netSalesCents: number
  profitCents: number
  roi: number | null
  activeCreators: number
  creatorsWithOrders: number
  creatorsWithoutCode: number
}

export interface AffiliatePerformanceResult {
  rows: AffiliateRow[]
  summary: AffiliateSummary
  alerts: AffiliateAlert[]
}

function pct(n: number, d: number): number | null {
  return d > 0 ? (n / d) * 100 : null
}

function peso(cents: number): string {
  return `₱${(cents / 100).toLocaleString('en-PH', { maximumFractionDigits: 0 })}`
}

export function toAffiliateRow(
  r: PerformanceRow,
  now = new Date(),
): AffiliateRow {
  const num = (v: number | string | null) => Number(v ?? 0)
  const gifts = num(r.gifts_cents)
  const fees = num(r.content_fees_cents)
  const other = num(r.other_expenses_cents)
  const commission = num(r.commission_earned_cents)
  const spent = gifts + fees + other + commission
  const orderProfit = num(r.order_profit_cents)
  const profit = orderProfit - commission - gifts - fees - other
  const netSales = num(r.net_sales_cents)
  const roi = roiOf(profit, spent)
  const eligible = num(r.commission_eligible_cents)
  const onHold = num(r.commission_on_hold_cents)
  return {
    creatorId: r.creator_id,
    name: r.name,
    isActive: r.is_active,
    tiktokUrl: r.tiktok_url,
    instagramUrl: r.instagram_url,
    facebookUrl: r.facebook_url,
    codes: r.codes.map((code, i) => {
      const brand = r.code_brands[i] ?? 'spades'
      return { code, brand, link: creatorLink(code, brand) }
    }),
    status: affiliateStatus(
      {
        hasActiveCode: r.has_active_code,
        lifetimeExpensesCents: num(r.lifetime_expenses_cents),
        orders: r.orders,
        roi,
        lastGiftAt: r.last_gift_at,
        ordersSinceLastGift: r.orders_since_last_gift,
        profit60dCents: num(r.profit_60d_cents),
        spent60dCents: num(r.spent_60d_cents),
      },
      now,
    ),
    spentCents: spent,
    giftsCents: gifts,
    feesCents: fees,
    otherExpensesCents: other,
    commissionEarnedCents: commission,
    linkClicks: r.link_clicks,
    orders: r.orders,
    codeOrders: r.code_orders,
    linkOrders: r.link_orders,
    attributedOrders: r.attributed_orders,
    cancelReturnPct: pct(r.cancel_return_orders, r.attributed_orders),
    netSalesCents: netSales,
    cogsCents: num(r.cogs_cents),
    orderProfitCents: orderProfit,
    profitCents: profit,
    roi,
    costPerOrderCents: r.orders > 0 ? Math.round(spent / r.orders) : null,
    aovCents: r.orders > 0 ? Math.round(netSales / r.orders) : null,
    newCustomerPct: pct(r.new_customer_orders, r.orders),
    clickToOrderPct: pct(r.link_orders, r.link_clicks),
    lastOrderAt: r.last_order_at,
    lastGiftAt: r.last_gift_at,
    daysSinceLastGift: daysSince(r.last_gift_at, now),
    ordersSinceLastGift: r.orders_since_last_gift,
    commissionOwedCents: eligible + onHold,
    commissionEligibleCents: eligible,
    commissionOnHoldCents: onHold,
  }
}

export function buildAffiliateAlerts(rows: AffiliateRow[]): AffiliateAlert[] {
  const alerts: AffiliateAlert[] = []
  const rules = AFFILIATE_STATUS_RULES
  for (const r of rows) {
    if (r.status === 'no_code') {
      alerts.push({
        kind: 'no_code',
        creatorId: r.creatorId,
        creatorName: r.name,
        message: `${r.name} got gifts/fees but has no active code — their sales can't be tracked.`,
      })
    }
    if (
      r.daysSinceLastGift !== null &&
      r.daysSinceLastGift >= rules.stopDaysSinceGift &&
      r.ordersSinceLastGift === 0 &&
      r.status !== 'no_code'
    ) {
      alerts.push({
        kind: 'no_orders_after_gift',
        creatorId: r.creatorId,
        creatorName: r.name,
        message: `${r.name}: 0 orders in the ${r.daysSinceLastGift} days since their last gift/fee.`,
      })
    }
    if (r.status === 'scale') {
      alerts.push({
        kind: 'scale',
        creatorId: r.creatorId,
        creatorName: r.name,
        message: `${r.name} qualifies for Scale (${r.roi?.toFixed(1)}× ROI, ${r.orders} orders).`,
      })
    }
    if (r.commissionEligibleCents >= rules.payoutAlertMinCents) {
      alerts.push({
        kind: 'payout_ready',
        creatorId: r.creatorId,
        creatorName: r.name,
        message: `${peso(r.commissionEligibleCents)} commission ready to pay to ${r.name}.`,
      })
    }
  }
  return alerts
}

export function summarize(rows: AffiliateRow[]): AffiliateSummary {
  const s = rows.reduce(
    (acc, r) => ({
      giftsCents: acc.giftsCents + r.giftsCents,
      feesCents: acc.feesCents + r.feesCents,
      otherExpensesCents: acc.otherExpensesCents + r.otherExpensesCents,
      commissionEarnedCents:
        acc.commissionEarnedCents + r.commissionEarnedCents,
      orders: acc.orders + r.orders,
      netSalesCents: acc.netSalesCents + r.netSalesCents,
      profitCents: acc.profitCents + r.profitCents,
    }),
    {
      giftsCents: 0,
      feesCents: 0,
      otherExpensesCents: 0,
      commissionEarnedCents: 0,
      orders: 0,
      netSalesCents: 0,
      profitCents: 0,
    },
  )
  const spentCents =
    s.giftsCents + s.feesCents + s.otherExpensesCents + s.commissionEarnedCents
  return {
    ...s,
    spentCents,
    roi: roiOf(s.profitCents, spentCents),
    activeCreators: rows.filter((r) => r.isActive).length,
    creatorsWithOrders: rows.filter((r) => r.orders > 0).length,
    creatorsWithoutCode: rows.filter((r) => r.isActive && r.codes.length === 0)
      .length,
  }
}

export const getAffiliatePerformance = createServerFn({ method: 'GET' })
  .validator(rangeSchema)
  .handler(async ({ data }): Promise<AffiliatePerformanceResult> => {
    await authorize()
    const db = getSupabaseAdminClient()
    const { start, end } = rangeBounds(data)
    const { data: raw, error } = await db.rpc('creator_performance', {
      p_start: start,
      p_end: end,
    })
    if (error) throw new Error(error.message)
    const now = new Date()
    const rows = (raw as unknown as PerformanceRow[])
      .map((r) => toAffiliateRow(r, now))
      // Hide creators with nothing at all to show (no spend, no orders,
      // no code) — they'd only be noise in the leaderboard.
      .filter(
        (r) =>
          r.spentCents > 0 ||
          r.attributedOrders > 0 ||
          r.codes.length > 0 ||
          r.linkClicks > 0 ||
          r.lastGiftAt !== null ||
          r.commissionOwedCents > 0,
      )
      .sort((a, b) => b.profitCents - a.profitCents)
    return {
      rows,
      summary: summarize(rows),
      alerts: buildAffiliateAlerts(rows),
    }
  })

export interface AffiliateDetail {
  creator: {
    id: string
    name: string
    notes: string | null
    isActive: boolean
    tiktokUrl: string | null
    instagramUrl: string | null
    facebookUrl: string | null
  } | null
  daily: { date: string; orders: number; netSalesCents: number }[]
  clicksDaily: { date: string; clicks: number }[]
  expenses: {
    id: string
    kind: 'gift' | 'content_fee' | 'other'
    description: string
    amountCents: number
    quantity: number | null
    unitCostCents: number | null
    incurredAt: string
    date: string
    productName: string | null
    variantLabel: string | null
    ordersBefore14d: number
    ordersAfter14d: number
  }[]
  orders: {
    orderId: string
    orderNumber: string
    placedAt: string
    status: string
    attributionType: 'code' | 'link'
    code: string
    netSalesCents: number
    profitCents: number
    commissionCents: number
    paidCents: number
    commissionStatus: string
    rateKind: 'normal' | 'sale' | 'mixed'
    isNewCustomer: boolean
    isCancelOrReturn: boolean
  }[]
  topProducts: {
    productName: string
    quantity: number
    netSalesCents: number
  }[]
  payouts: {
    id: string
    reference: string
    amountCents: number
    createdAt: string
  }[]
}

export const getAffiliateCreatorDetail = createServerFn({ method: 'GET' })
  .validator(rangeSchema.extend({ creatorId: z.string().uuid() }))
  .handler(async ({ data }): Promise<AffiliateDetail> => {
    await authorize()
    const db = getSupabaseAdminClient()
    const { start, end } = rangeBounds(data)
    const { data: raw, error } = await db.rpc('creator_detail', {
      p_creator_id: data.creatorId,
      p_start: start,
      p_end: end,
      p_tz: TZ_IANA[data.tz],
    })
    if (error) throw new Error(error.message)
    return raw as unknown as AffiliateDetail
  })

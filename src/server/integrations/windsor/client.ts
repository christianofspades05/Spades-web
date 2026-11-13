/**
 * Windsor.ai (onboard.windsor.ai) — blended marketing-data connector. Used
 * only to pull Meta/Facebook Ads spend for the admin Expenses page; Windsor
 * also has other sources configured (Google Ads, Instagram, etc.) but
 * nothing here reads them yet. Response amounts are decimal numbers in PHP
 * major units (confirmed against the Meta Ads Manager figures directly).
 */
import { majorUnitsToCents } from '#/lib/utils/money'

const WINDSOR_BASE_URL = 'https://connectors.windsor.ai/all'

interface WindsorAllRow {
  source?: string
  spend?: number
  campaign?: string
  date?: string
  /** Meta's current effective status for the campaign (ACTIVE, PAUSED,
   *  CAMPAIGN_PAUSED, ARCHIVED, ...) — today's status, repeated on every
   *  row, not the status as of that row's date. */
  campaign_effective_status?: string
}

export async function getMetaAdSpendCents(range: {
  from: string
  to: string
}): Promise<number> {
  const apiKey = process.env.WINDSOR_API_KEY
  if (!apiKey) return 0

  const url = new URL(WINDSOR_BASE_URL)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('date_from', range.from)
  url.searchParams.set('date_to', range.to)
  url.searchParams.set('fields', 'source,spend')

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Windsor.ai request failed: ${response.status}`)
  }
  const body = (await response.json()) as { data?: WindsorAllRow[] }
  // Filter to facebook explicitly rather than trusting an unfiltered sum —
  // other sources (Google Ads, etc.) may get added to this Windsor account
  // later and would otherwise silently inflate "ads spend" here.
  const totalSpend = (body.data ?? [])
    .filter((row) => row.source === 'facebook')
    .reduce((sum, row) => sum + (row.spend ?? 0), 0)
  return majorUnitsToCents(totalSpend, 'PHP')
}

/**
 * Same Windsor.ai "all" connector as getMetaAdSpendCents above, but broken
 * down by campaign — used by the admin Ads Efficiency page's per-campaign
 * ROAS/cost-per-purchase table (see server/admin/campaign-mapping.ts and
 * getCampaignAdsPerformance in server/admin/analytics.ts). Matched against
 * the admin-maintained meta_campaign_product_mappings table by campaign
 * *name* (the simplest thing for staff to read off Ads Manager directly),
 * which is also the same name Windsor reports here. Rows are summed per
 * campaign name across the whole range — Windsor returns one row per
 * campaign per day at this grain. Also carries each campaign's current
 * Meta effective status, so the page can filter to campaigns still running.
 */
export interface CampaignSpend {
  spendCents: number
  /** Uppercase Meta effective status (e.g. 'ACTIVE', 'PAUSED'), or null if
   *  Windsor didn't report one. */
  effectiveStatus: string | null
}

export async function getMetaCampaignSpendCents(range: {
  from: string
  to: string
}): Promise<Map<string, CampaignSpend>> {
  const apiKey = process.env.WINDSOR_API_KEY
  if (!apiKey) return new Map()

  const url = new URL(WINDSOR_BASE_URL)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('date_from', range.from)
  url.searchParams.set('date_to', range.to)
  url.searchParams.set(
    'fields',
    'source,campaign,campaign_effective_status,spend',
  )

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Windsor.ai request failed: ${response.status}`)
  }
  const body = (await response.json()) as { data?: WindsorAllRow[] }

  const byCampaign = new Map<
    string,
    { spend: number; effectiveStatus: string | null }
  >()
  for (const row of body.data ?? []) {
    if (row.source !== 'facebook' || !row.campaign) continue
    const existing = byCampaign.get(row.campaign)
    const status = row.campaign_effective_status?.toUpperCase() ?? null
    if (existing) {
      existing.spend += row.spend ?? 0
      existing.effectiveStatus ??= status
    } else {
      byCampaign.set(row.campaign, {
        spend: row.spend ?? 0,
        effectiveStatus: status,
      })
    }
  }
  return new Map(
    Array.from(byCampaign.entries()).map(([name, entry]) => [
      name,
      {
        spendCents: majorUnitsToCents(entry.spend, 'PHP'),
        effectiveStatus: entry.effectiveStatus,
      },
    ]),
  )
}

export interface CampaignActivity {
  spendCents: number
  /** Most recent day (within the requested range) Windsor reported any
   *  spend for this campaign — used to sort/surface recently-active
   *  campaigns on the admin Campaign Mapping screen. Not the campaign's
   *  actual start date in Ads Manager, just the latest day it had spend
   *  in the window queried. */
  lastSpendDate: string
}

/**
 * Same per-campaign breakdown as getMetaCampaignSpendCents, but also keeps
 * each campaign's most recent spend date — used only by the admin Campaign
 * Mapping screen's "Last spend" column/sort (see
 * server/admin/campaign-mapping.ts). A separate function rather than
 * folding this into getMetaCampaignSpendCents's return type because that
 * one is also used by getCampaignAdsPerformance, which has no use for a
 * date.
 */
export async function getMetaCampaignActivity(range: {
  from: string
  to: string
}): Promise<Map<string, CampaignActivity>> {
  const apiKey = process.env.WINDSOR_API_KEY
  if (!apiKey) return new Map()

  const url = new URL(WINDSOR_BASE_URL)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('date_from', range.from)
  url.searchParams.set('date_to', range.to)
  url.searchParams.set('fields', 'source,campaign,date,spend')

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Windsor.ai request failed: ${response.status}`)
  }
  const body = (await response.json()) as { data?: WindsorAllRow[] }

  const activity = new Map<string, CampaignActivity>()
  for (const row of body.data ?? []) {
    if (row.source !== 'facebook' || !row.campaign || !row.date) continue
    const spendCents = majorUnitsToCents(row.spend ?? 0, 'PHP')
    const existing = activity.get(row.campaign)
    if (existing) {
      existing.spendCents += spendCents
      if (row.date > existing.lastSpendDate) existing.lastSpendDate = row.date
    } else {
      activity.set(row.campaign, { spendCents, lastSpendDate: row.date })
    }
  }
  return activity
}

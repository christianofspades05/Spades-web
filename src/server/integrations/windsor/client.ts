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
 * computeCampaignAdsPerformance in server/admin/analytics.ts). Matched
 * against orders by campaign *name* (orders.ad_campaign_name, captured
 * client-side from a utm_campaign URL parameter — see
 * lib/analytics/campaign.ts) rather than Meta's numeric campaign id, since
 * that's the simplest thing for staff to read off Ads Manager directly when
 * setting up the admin-side mapping, and it's the same name Windsor reports
 * here. Rows are summed per campaign name across the whole range — Windsor
 * returns one row per campaign per day at this grain.
 */
export async function getMetaCampaignSpendCents(range: {
  from: string
  to: string
}): Promise<Map<string, number>> {
  const apiKey = process.env.WINDSOR_API_KEY
  if (!apiKey) return new Map()

  const url = new URL(WINDSOR_BASE_URL)
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('date_from', range.from)
  url.searchParams.set('date_to', range.to)
  url.searchParams.set('fields', 'source,campaign,spend')

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Windsor.ai request failed: ${response.status}`)
  }
  const body = (await response.json()) as { data?: WindsorAllRow[] }

  const spendByCampaign = new Map<string, number>()
  for (const row of body.data ?? []) {
    if (row.source !== 'facebook' || !row.campaign) continue
    spendByCampaign.set(
      row.campaign,
      (spendByCampaign.get(row.campaign) ?? 0) + (row.spend ?? 0),
    )
  }
  return new Map(
    Array.from(spendByCampaign.entries()).map(([name, spend]) => [
      name,
      majorUnitsToCents(spend, 'PHP'),
    ]),
  )
}

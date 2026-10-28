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

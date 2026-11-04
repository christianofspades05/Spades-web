const STORAGE_KEY = 'spades_ad_campaign'
const ATTRIBUTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

interface StoredAdCampaign {
  campaignName: string
  capturedAt: number
}

/** First-click Meta ad-campaign attribution — same storage/window rules as
 *  fbclid.ts, captured from a `utm_campaign` URL parameter. That parameter
 *  only shows up if the advertiser has set a URL parameter template on the
 *  campaign's destination link in Ads Manager (e.g.
 *  `utm_campaign={{campaign.name}}`) — nothing captures without that being
 *  set up on the Meta side. The captured name is later matched against
 *  Windsor.ai's own per-campaign spend breakdown and an admin-maintained
 *  campaign->product mapping (see server/admin/campaign-mapping.ts) to
 *  compute ROAS/cost-per-purchase per campaign on the Ads Efficiency page. */
export function captureAdCampaign(search: string): void {
  const campaignName = new URLSearchParams(search).get('utm_campaign')
  if (!campaignName) return
  if (readStoredAdCampaign()) return

  const stored: StoredAdCampaign = { campaignName, capturedAt: Date.now() }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
}

function readStoredAdCampaign(): StoredAdCampaign | null {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  const parsed = JSON.parse(raw) as StoredAdCampaign
  if (Date.now() - parsed.capturedAt > ATTRIBUTION_WINDOW_MS) {
    window.localStorage.removeItem(STORAGE_KEY)
    return null
  }
  return parsed
}

/** The campaign name to attach to an order at checkout, or null once it's
 *  expired (30 days past capture) or was never captured this browser. */
export function getAttributedAdCampaign(): string | null {
  return readStoredAdCampaign()?.campaignName ?? null
}

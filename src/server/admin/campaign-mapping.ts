/**
 * Admin "Campaign -> Products" mapping (meta_campaign_product_mappings):
 * lets staff tell the Ads Efficiency page which product(s) each Meta ad
 * campaign is advertising (one row per campaign/product pair), so
 * ROAS/cost-per-purchase can be shown per campaign (see getCampaignAdsPerformance in analytics.ts, which matches
 * sales by the mapped product's own order history, not click attribution).
 * Campaign discovery comes from Windsor.ai's per-campaign spend breakdown —
 * the actual list of campaigns in the connected Meta ad account — not from
 * order data, so a campaign can be mapped before any order exists for its
 * product.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { daysAgo } from '#/lib/utils/date-range'
import { getMetaCampaignActivity } from '#/server/integrations/windsor/client'
import { logStaffActivity } from './activity-log'
import type { StaffRole } from '#/types/entities'

const MANAGE_ROLES: StaffRole[] = ['super_admin', 'admin', 'manager']

// Only campaigns with at least some spend in this trailing window show up
// on the mapping screen — a Meta ad account accumulates years of fully
// paused campaigns that would otherwise swamp the list with nothing to map.
const CAMPAIGN_DISCOVERY_WINDOW_DAYS = 90

export interface CampaignMappedProduct {
  id: string
  name: string
  image: string | null
}

export interface CampaignMappingRow {
  campaignName: string
  spendCents: number
  /** Most recent day (within the trailing 90-day window) Windsor reported
   *  any spend for this campaign — not its actual start date in Ads
   *  Manager. Lets the admin screen sort by recency. */
  lastSpendDate: string
  /** Every product this campaign advertises. The Ads Efficiency page splits
   *  the campaign's spend evenly across them. */
  products: CampaignMappedProduct[]
}

export const getCampaignMappings = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CampaignMappingRow[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const [campaignActivity, mappingRows] = await Promise.all([
      getMetaCampaignActivity({
        from: daysAgo(CAMPAIGN_DISCOVERY_WINDOW_DAYS),
        to: daysAgo(0),
      }),
      admin
        .from('meta_campaign_product_mappings')
        .select(
          'campaign_name, product_id, created_at, product:products(name, images)',
        )
        .order('created_at')
        .then(({ data, error }) => {
          if (error) throw error
          return data
        }),
    ])

    const productsByCampaign = new Map<string, CampaignMappedProduct[]>()
    for (const row of mappingRows) {
      const list = productsByCampaign.get(row.campaign_name) ?? []
      list.push({
        id: row.product_id,
        name: row.product.name,
        image: row.product.images[0] ?? null,
      })
      productsByCampaign.set(row.campaign_name, list)
    }

    return Array.from(campaignActivity.entries())
      .filter(([, activity]) => activity.spendCents > 0)
      .map(([campaignName, activity]) => ({
        campaignName,
        spendCents: activity.spendCents,
        lastSpendDate: activity.lastSpendDate,
        products: productsByCampaign.get(campaignName) ?? [],
      }))
      .sort((a, b) => b.spendCents - a.spendCents)
  },
)

const campaignProductSchema = z.object({
  campaignName: z.string().min(1).max(200),
  productId: z.string().uuid(),
})

export const addCampaignProduct = createServerFn({ method: 'POST' })
  .validator(campaignProductSchema)
  .handler(async ({ data }) => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('meta_campaign_product_mappings')
      .upsert(
        { campaign_name: data.campaignName, product_id: data.productId },
        { onConflict: 'campaign_name,product_id', ignoreDuplicates: true },
      )
    if (error) throw error

    await logStaffActivity(
      staff,
      'campaign_mapping.add_product',
      'meta_campaign_product_mapping',
      null,
      { campaignName: data.campaignName, productId: data.productId },
    )
  })

export const removeCampaignProduct = createServerFn({ method: 'POST' })
  .validator(campaignProductSchema)
  .handler(async ({ data }) => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('meta_campaign_product_mappings')
      .delete()
      .eq('campaign_name', data.campaignName)
      .eq('product_id', data.productId)
    if (error) throw error

    await logStaffActivity(
      staff,
      'campaign_mapping.remove_product',
      'meta_campaign_product_mapping',
      null,
      { campaignName: data.campaignName, productId: data.productId },
    )
  })

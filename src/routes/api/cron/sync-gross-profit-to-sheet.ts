/**
 * Pushes three "this month" figures from the admin dashboard into the
 * user's own "Income and Expenses" tracking spreadsheet, so it stays
 * current without anyone copying numbers over by hand:
 *   - C7:  Gross Profit (admin Profit page's Gross Profit card — see
 *          getSalesByChannel/computeChannelSales in server/admin/analytics.ts)
 *   - H25: TikTok Seller Fee (admin Expenses page's "TikTok fees" card —
 *          see computeTikTokFinanceSummary in server/admin/tiktok-finance.ts)
 *   - H26: Facebook Ads Monthly (Spades) (admin Expenses page's "Ads spend"
 *          card — see getMetaAdSpendCents in integrations/windsor/client.ts;
 *          confirmed with the user that this Windsor-connected Meta account
 *          is Spades-only, not blended with Ysrael/Aspire 365)
 *
 * Trigger via an external scheduler (cron-job.org) sending
 * `Authorization: Bearer $CRON_SECRET` — same reasoning as
 * sync-exchange-rates.ts for not adding this to vercel.json's already-capped
 * native cron list. Route path/filename kept as the original
 * "sync-gross-profit-to-sheet" name even though it now syncs more than
 * that one figure, so the already-configured cron-job.org job (which
 * targets this exact URL) doesn't need to be re-pointed.
 *
 * Spreadsheet/cells are hardcoded rather than env vars — this syncs
 * specific figures to one specific person's spreadsheet, not a general
 * integration other code reuses.
 */
import { createFileRoute } from '@tanstack/react-router'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { computeChannelSales } from '#/server/admin/analytics'
import { computeTikTokFinanceSummary } from '#/server/admin/tiktok-finance'
import { getMetaAdSpendCents } from '#/server/integrations/windsor/client'
import { resolveDateRange } from '#/lib/utils/date-range'
import { updateSheetValues } from '#/server/integrations/google-sheets/client'

const SPREADSHEET_ID = '1mTWb-6skMrFTHlih8fbNh-hd7rEKgIkxzOvCCpWQJW0'
const GROSS_PROFIT_RANGE = "'INCOME AND EXPENSES'!C7"
const TIKTOK_FEE_RANGE = "'INCOME AND EXPENSES'!H25"
const FACEBOOK_ADS_RANGE = "'INCOME AND EXPENSES'!H26"

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('CRON_SECRET is not set — rejecting all cron requests.')
    return false
  }
  return request.headers.get('authorization') === `Bearer ${expected}`
}

export const Route = createFileRoute('/api/cron/sync-gross-profit-to-sheet')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthorized(request)) {
          return new Response('Unauthorized', { status: 401 })
        }

        const admin = getSupabaseAdminClient()
        const { from, to } = resolveDateRange('this_month', {})

        const [channelSales, tiktokSummary, metaAdSpendCents] =
          await Promise.all([
            computeChannelSales(admin, from, to, undefined, undefined, 'ph'),
            computeTikTokFinanceSummary({ from, to }),
            getMetaAdSpendCents({ from, to }),
          ])

        const grossProfitPesos = channelSales.totals.netProfitCents / 100
        const tiktokFeePesos = Math.abs(tiktokSummary.totals.feeCents) / 100
        const facebookAdsPesos = metaAdSpendCents / 100

        await updateSheetValues(SPREADSHEET_ID, [
          { a1Range: GROSS_PROFIT_RANGE, value: grossProfitPesos },
          { a1Range: TIKTOK_FEE_RANGE, value: tiktokFeePesos },
          { a1Range: FACEBOOK_ADS_RANGE, value: facebookAdsPesos },
        ])

        return Response.json({
          range: { from, to },
          grossProfitPesos,
          tiktokFeePesos,
          facebookAdsPesos,
        })
      },
    },
  },
})

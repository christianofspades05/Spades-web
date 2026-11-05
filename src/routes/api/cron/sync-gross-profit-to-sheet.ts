/**
 * Pushes "this month"'s Gross Profit (the same figure the admin Profit
 * page's Gross Profit card shows — see getSalesByChannel/computeChannelSales
 * in server/admin/analytics.ts) into cell C7 of the user's own "Income and
 * Expenses" tracking spreadsheet, so that sheet stays current without
 * anyone copying the number over by hand. Trigger via an external scheduler
 * (cron-job.org) sending `Authorization: Bearer $CRON_SECRET` — same
 * reasoning as sync-exchange-rates.ts for not adding this to vercel.json's
 * already-capped native cron list.
 *
 * Spreadsheet/cell are hardcoded rather than env vars — this syncs one
 * specific figure to one specific person's spreadsheet, not a general
 * integration other code reuses.
 */
import { createFileRoute } from '@tanstack/react-router'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { computeChannelSales } from '#/server/admin/analytics'
import { resolveDateRange } from '#/lib/utils/date-range'
import { updateSheetValue } from '#/server/integrations/google-sheets/client'

const SPREADSHEET_ID = '1mTWb-6skMrFTHlih8fbNh-hd7rEKgIkxzOvCCpWQJW0'
const TARGET_RANGE = "'INCOME AND EXPENSES'!C7"

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
        const { totals } = await computeChannelSales(
          admin,
          from,
          to,
          undefined,
          undefined,
          'ph',
        )
        const grossProfitPesos = totals.netProfitCents / 100

        await updateSheetValue(SPREADSHEET_ID, TARGET_RANGE, grossProfitPesos)

        return Response.json({ range: { from, to }, grossProfitPesos })
      },
    },
  },
})

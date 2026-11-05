/**
 * Pushes three "this month" figures from the admin dashboard into the
 * user's own "Income and Expenses" tracking spreadsheet, so it stays
 * current without anyone copying numbers over by hand:
 *   - C7:  Gross Profit (admin Profit page's Gross Profit card — see
 *          getSalesByChannel/computeChannelSales in server/admin/analytics.ts)
 *   - H25: TikTok Seller Fee (admin Expenses page's "TikTok fees" card —
 *          same totals.feeCents sum as getTikTokFinanceSummary in
 *          server/admin/tiktok-finance.ts, reimplemented inline below
 *          rather than imported — see the note above the TikTok block)
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
 * Every server-only module here is loaded with a dynamic `await import()`
 * inside the handler, same as sync-exchange-rates.ts's own admin-client
 * import — NOT just style preference. tiktok-shop/client.ts signs requests
 * with `node:crypto`'s createHmac at module scope; a *static* top-level
 * import of anything that transitively reaches it defeats TanStack Start's
 * client/server code-splitting for the whole importing module (confirmed
 * live: statically exporting a plain helper that called into it from
 * server/admin/tiktok-finance.ts leaked that `node:crypto` import into the
 * browser bundle and broke chart rendering app-wide, since that file is
 * also imported by the real, client-facing TikTok Finance admin page).
 * Dynamic imports here are only ever reached from this server route's own
 * handler, so they can never end up in a client bundle no matter what they
 * touch.
 *
 * Spreadsheet/cells are hardcoded rather than env vars — this syncs
 * specific figures to one specific person's spreadsheet, not a general
 * integration other code reuses.
 */
import { createFileRoute } from '@tanstack/react-router'
import { resolveDateRange, storeRangeToUtcBounds } from '#/lib/utils/date-range'

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

/** Same whole-shop fee sum as getTikTokFinanceSummary's totals.feeCents —
 *  reimplemented here instead of imported so this route never statically
 *  pulls in tiktok-shop/client.ts's node:crypto usage (see file doc
 *  comment above). */
async function getTikTokFeeCentsThisMonth(
  from: string,
  to: string,
): Promise<number> {
  const { getSupabaseAdminClient } = await import('#/lib/supabase/admin')
  const { ensureFreshConnection } =
    await import('#/server/integrations/marketplaces/sync-engine')
  const { getTikTokFinanceStatements } =
    await import('#/server/integrations/marketplaces/tiktok-shop/adapter')

  const admin = getSupabaseAdminClient()
  const { data: connection, error } = await admin
    .from('marketplace_connections')
    .select('*')
    .eq('marketplace', 'tiktok_shop')
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  if (!connection) return 0

  const fresh = await ensureFreshConnection(connection)
  const { start, end } = storeRangeToUtcBounds(from, to)
  const statements = await getTikTokFinanceStatements(fresh, {
    sinceSeconds: Math.floor(new Date(start).getTime() / 1000),
    untilSeconds: Math.floor(new Date(end).getTime() / 1000),
  })
  return statements.reduce((sum, s) => sum + s.feeCents, 0)
}

export const Route = createFileRoute('/api/cron/sync-gross-profit-to-sheet')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthorized(request)) {
          return new Response('Unauthorized', { status: 401 })
        }

        const { from, to } = resolveDateRange('this_month', {})

        const [
          { getSupabaseAdminClient },
          { computeChannelSales },
          { getMetaAdSpendCents },
          { updateSheetValues },
        ] = await Promise.all([
          import('#/lib/supabase/admin'),
          import('#/server/admin/analytics'),
          import('#/server/integrations/windsor/client'),
          import('#/server/integrations/google-sheets/client'),
        ])

        const admin = getSupabaseAdminClient()

        const [channelSales, tiktokFeeCents, metaAdSpendCents] =
          await Promise.all([
            computeChannelSales(admin, from, to, undefined, undefined, 'ph'),
            getTikTokFeeCentsThisMonth(from, to),
            getMetaAdSpendCents({ from, to }),
          ])

        const grossProfitPesos = channelSales.totals.netProfitCents / 100
        const tiktokFeePesos = Math.abs(tiktokFeeCents) / 100
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

/**
 * Frequent order pull, meant to be triggered by an external scheduler
 * (e.g. cron-job.org) every few minutes — NOT registered in vercel.json,
 * deliberately, since Vercel's own cron feature on this project's plan
 * caps projects at 2 jobs run at most once a day (see
 * sync-channels-daily.ts). An external trigger calling this route directly
 * bypasses that limit entirely; sync-channels-daily.ts still runs once a
 * day as a fallback in case the external scheduler ever stops firing.
 *
 * The lookback window is wider than the intended polling interval so a
 * single missed/failed run doesn't lose orders; pulling the same order
 * twice is a no-op (see sync-engine.ts's dedupe on
 * orders.external_order_id).
 *
 * getSupabaseAdminClient/sync-engine are imported dynamically inside the
 * handler, not at the top level, for the same reason as
 * src/routes/api/cron/review-requests.ts: routeTree.gen.ts eagerly imports
 * every route file, and a `server.handlers` route doesn't get server-only
 * code split out of the client bundle automatically.
 */
import { createFileRoute } from '@tanstack/react-router'
import type { MarketplaceName } from '#/types/entities'
import type { SyncableMarketplace } from '#/server/integrations/marketplaces/types'

const LOOKBACK_MINUTES = 15

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('CRON_SECRET is not set — rejecting all cron requests.')
    return false
  }
  return request.headers.get('authorization') === `Bearer ${expected}`
}

function isSyncable(
  marketplace: MarketplaceName,
): marketplace is SyncableMarketplace {
  return marketplace !== 'other'
}

export const Route = createFileRoute('/api/cron/sync-channels-pull-orders')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthorized(request)) {
          return new Response('Unauthorized', { status: 401 })
        }

        const { getSupabaseAdminClient } = await import('#/lib/supabase/admin')
        const { pullOrdersForMarketplace } =
          await import('#/server/integrations/marketplaces/sync-engine')

        const admin = getSupabaseAdminClient()
        const { data: connections, error } = await admin
          .from('marketplace_connections')
          .select('marketplace')
          .eq('status', 'active')
        if (error) throw error

        const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000)

        // One marketplace's pull hanging/being slow shouldn't add to
        // another's wall-clock time — each is independent, so they run
        // concurrently rather than one after another.
        const entries = await Promise.all(
          connections
            .filter((c): c is { marketplace: SyncableMarketplace } =>
              isSyncable(c.marketplace),
            )
            .map(async (connection) => {
              try {
                const result = await pullOrdersForMarketplace(
                  connection.marketplace,
                  since,
                )
                return [connection.marketplace, result] as const
              } catch (err) {
                return [
                  connection.marketplace,
                  { error: err instanceof Error ? err.message : String(err) },
                ] as const
              }
            }),
        )
        const results = Object.fromEntries(entries)

        return Response.json({ since: since.toISOString(), results })
      },
    },
  },
})

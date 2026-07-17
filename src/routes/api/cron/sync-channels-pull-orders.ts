/**
 * Pulls new/updated orders from every connected marketplace. Runs every few
 * minutes (see vercel.json) — the lookback window below is deliberately
 * wider than the cron interval so a single missed/failed run doesn't lose
 * orders; pulling the same order twice is a no-op (see sync-engine.ts's
 * dedupe on orders.external_order_id).
 *
 * getSupabaseAdminClient/sync-engine are imported dynamically inside the
 * handler, not at the top level, for the same reason as
 * src/routes/api/cron/review-requests.ts: routeTree.gen.ts eagerly imports
 * every route file, and a `server.handlers` route doesn't get server-only
 * code split out of the client bundle automatically.
 */
import { createFileRoute } from '@tanstack/react-router'

const LOOKBACK_MINUTES = 30

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('CRON_SECRET is not set — rejecting all cron requests.')
    return false
  }
  return request.headers.get('authorization') === `Bearer ${expected}`
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
        const results: Record<string, unknown> = {}

        for (const connection of connections) {
          if (connection.marketplace === 'other') continue
          try {
            results[connection.marketplace] = await pullOrdersForMarketplace(
              connection.marketplace,
              since,
            )
          } catch (err) {
            results[connection.marketplace] = {
              error: err instanceof Error ? err.message : String(err),
            }
          }
        }

        return Response.json({ since: since.toISOString(), results })
      },
    },
  },
})

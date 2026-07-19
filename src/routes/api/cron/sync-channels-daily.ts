/**
 * Daily channel sync: pulls new/updated orders from every connected
 * marketplace, then re-pushes current stock for every linked product.
 * Combined into one cron job because the Vercel plan this project runs on
 * caps projects at 2 cron jobs, each at most once a day (see the other
 * existing cron, review-requests.ts) — a separate 30-minute order-pull job
 * isn't allowed, so this trades sync latency for staying on that plan.
 *
 * The lookback window is wider than the 24h interval so a single missed/
 * failed run doesn't lose orders; pulling the same order twice is a no-op
 * (see sync-engine.ts's dedupe on orders.external_order_id). Inventory
 * reconciliation is push-only (no "read platform inventory" method exists
 * on the adapter interface) — see sync-engine.ts's pushInventoryForVariant
 * comment on the accepted last-write-wins limitation.
 *
 * getSupabaseAdminClient/sync-engine are imported dynamically inside the
 * handler, not at the top level, for the same reason as
 * src/routes/api/cron/review-requests.ts: routeTree.gen.ts eagerly imports
 * every route file, and a `server.handlers` route doesn't get server-only
 * code split out of the client bundle automatically.
 */
import { createFileRoute } from '@tanstack/react-router'

const LOOKBACK_HOURS = 26

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('CRON_SECRET is not set — rejecting all cron requests.')
    return false
  }
  return request.headers.get('authorization') === `Bearer ${expected}`
}

export const Route = createFileRoute('/api/cron/sync-channels-daily')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthorized(request)) {
          return new Response('Unauthorized', { status: 401 })
        }

        const { getSupabaseAdminClient } = await import('#/lib/supabase/admin')
        const {
          pullOrdersForMarketplace,
          pullReturnsForMarketplace,
          pushInventoryForAllProducts,
        } = await import('#/server/integrations/marketplaces/sync-engine')

        const admin = getSupabaseAdminClient()
        const { data: connections, error } = await admin
          .from('marketplace_connections')
          .select('marketplace')
          .eq('status', 'active')
        if (error) throw error

        const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000)
        const pullResults: Record<string, unknown> = {}
        const returnResults: Record<string, unknown> = {}
        const reconcileResults: Record<string, unknown> = {}

        for (const connection of connections) {
          if (connection.marketplace === 'other') continue
          try {
            pullResults[connection.marketplace] = await pullOrdersForMarketplace(
              connection.marketplace,
              since,
            )
          } catch (err) {
            pullResults[connection.marketplace] = {
              error: err instanceof Error ? err.message : String(err),
            }
          }
          try {
            returnResults[connection.marketplace] =
              await pullReturnsForMarketplace(connection.marketplace, since)
          } catch (err) {
            returnResults[connection.marketplace] = {
              error: err instanceof Error ? err.message : String(err),
            }
          }
          try {
            reconcileResults[connection.marketplace] =
              await pushInventoryForAllProducts(connection.marketplace)
          } catch (err) {
            reconcileResults[connection.marketplace] = {
              error: err instanceof Error ? err.message : String(err),
            }
          }
        }

        return Response.json({
          since: since.toISOString(),
          pullResults,
          returnResults,
          reconcileResults,
        })
      },
    },
  },
})

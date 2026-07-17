/**
 * Re-pushes our current stock count for every linked product on every
 * connected marketplace. Catches drift between our numbers and whatever the
 * platform shows — e.g. a push that failed silently, or a platform-side
 * manual edit — by periodically re-asserting our own count as the source of
 * truth (push-only reconciliation, not pull-and-diff: there's no "read
 * their inventory" method in the adapter interface, and last-write-wins is
 * the accepted approach here, see sync-engine.ts's pushInventoryForVariant
 * comment). Runs daily (see vercel.json) — more often would risk rate
 * limits for not much benefit, since every real stock change already
 * triggers its own immediate push (src/server/admin/products.ts's
 * adjustInventory).
 */
import { createFileRoute } from '@tanstack/react-router'

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('CRON_SECRET is not set — rejecting all cron requests.')
    return false
  }
  return request.headers.get('authorization') === `Bearer ${expected}`
}

export const Route = createFileRoute(
  '/api/cron/sync-channels-reconcile-inventory',
)({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthorized(request)) {
          return new Response('Unauthorized', { status: 401 })
        }

        const { getSupabaseAdminClient } = await import('#/lib/supabase/admin')
        const { pushInventoryForAllProducts } =
          await import('#/server/integrations/marketplaces/sync-engine')

        const admin = getSupabaseAdminClient()
        const { data: connections, error } = await admin
          .from('marketplace_connections')
          .select('marketplace')
          .eq('status', 'active')
        if (error) throw error

        const results: Record<string, unknown> = {}
        for (const connection of connections) {
          if (connection.marketplace === 'other') continue
          try {
            results[connection.marketplace] = await pushInventoryForAllProducts(
              connection.marketplace,
            )
          } catch (err) {
            results[connection.marketplace] = {
              error: err instanceof Error ? err.message : String(err),
            }
          }
        }

        return Response.json({ results })
      },
    },
  },
})

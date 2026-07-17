/**
 * TikTok Shop's OAuth redirect target. Exchanges the `code` param for real
 * tokens and upserts the one `marketplace_connections` row for TikTok Shop
 * (see sync-engine.ts's comment on why: this app assumes one connected shop
 * per marketplace for now, even though the table's own unique constraint
 * — (marketplace, external_shop_id) — technically allows more).
 */
import { createFileRoute } from '@tanstack/react-router'

const OAUTH_STATE_COOKIE = 'spades_oauth_state'

export const Route = createFileRoute('/api/oauth/tiktok/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireStaff } = await import('#/lib/auth/guards')
        const { getAdapter } =
          await import('#/server/integrations/marketplaces/registry')
        const { getSupabaseAdminClient } = await import('#/lib/supabase/admin')
        const { getCookies, deleteCookie } =
          await import('@tanstack/react-start/server')

        let staff
        try {
          staff = await requireStaff(['super_admin', 'admin'])
        } catch {
          return new Response('Staff sign-in required', { status: 401 })
        }

        const url = new URL(request.url)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const expectedState = getCookies()[OAUTH_STATE_COOKIE]
        deleteCookie(OAUTH_STATE_COOKIE, { path: '/' })

        if (!code) {
          return Response.redirect(
            `${url.origin}/admin/channels?error=missing_code`,
            302,
          )
        }
        if (!state || state !== expectedState) {
          return Response.redirect(
            `${url.origin}/admin/channels?error=invalid_state`,
            302,
          )
        }

        const adapter = getAdapter('tiktok_shop')
        const admin = getSupabaseAdminClient()

        try {
          const tokens = await adapter.exchangeCodeForTokens(code)

          const { data: existing } = await admin
            .from('marketplace_connections')
            .select('id')
            .eq('marketplace', 'tiktok_shop')
            .maybeSingle()

          const row = {
            marketplace: 'tiktok_shop' as const,
            external_shop_id: tokens.shopId,
            shop_name: tokens.shopName ?? null,
            access_token_encrypted: tokens.accessToken,
            refresh_token_encrypted: tokens.refreshToken,
            token_expires_at: tokens.tokenExpiresAt,
            status: 'active' as const,
            connected_by: staff.id,
          }

          if (existing) {
            await admin
              .from('marketplace_connections')
              .update(row)
              .eq('id', existing.id)
          } else {
            await admin.from('marketplace_connections').insert(row)
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Connection failed'
          return Response.redirect(
            `${url.origin}/admin/channels?error=${encodeURIComponent(message)}`,
            302,
          )
        }

        return Response.redirect(
          `${url.origin}/admin/channels?connected=tiktok_shop`,
          302,
        )
      },
    },
  },
})

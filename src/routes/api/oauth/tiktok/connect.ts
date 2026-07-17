/**
 * Starts the TikTok Shop OAuth connect flow. Staff clicks "Connect" on the
 * admin Channels page, which links here; this redirects to TikTok's own
 * authorization screen. TikTok redirects back to callback.ts once the
 * seller approves.
 *
 * Dynamic imports (not top-level) for the same reason as
 * src/routes/api/webhooks/xendit.ts: routeTree.gen.ts eagerly imports every
 * route file for the client's route tree, and a `server.handlers` route
 * doesn't get server-only code split out of the client bundle automatically.
 */
import { createFileRoute } from '@tanstack/react-router'

const OAUTH_STATE_COOKIE = 'spades_oauth_state'

export const Route = createFileRoute('/api/oauth/tiktok/connect')({
  server: {
    handlers: {
      GET: async () => {
        const { requireStaff } = await import('#/lib/auth/guards')
        const { getAdapter } =
          await import('#/server/integrations/marketplaces/registry')
        const { setCookie } = await import('@tanstack/react-start/server')

        try {
          await requireStaff(['super_admin', 'admin'])
        } catch {
          return new Response('Staff sign-in required', { status: 401 })
        }

        const adapter = getAdapter('tiktok_shop')
        const state = crypto.randomUUID()
        setCookie(OAUTH_STATE_COOKIE, state, {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: 600,
        })

        // Response.redirect() returns a Response with immutable headers per
        // the Fetch spec, which crashes when the framework tries to merge in
        // the Set-Cookie header from setCookie() above. Build it manually
        // instead so the headers stay mutable.
        return new Response(null, {
          status: 302,
          headers: { Location: adapter.getAuthorizationUrl(state) },
        })
      },
    },
  },
})

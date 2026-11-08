/**
 * Checkout funnel event ingestion — the one part of storefront tracking
 * that can't go through recordVisit's createServerFn (see analytics/
 * track.ts's insertStorefrontVisit, which this calls and which is the only
 * place that actually does the insert). navigator.sendBeacon and
 * fetch(..., {keepalive:true}) — the only two mechanisms that reliably
 * survive a page about to redirect/unload (checkout_place_order_clicked,
 * checkout_payment_redirect) — both need a plain HTTP endpoint to POST to,
 * not a framework RPC call. See lib/analytics/checkout-tracking.ts for the
 * client side of this.
 *
 * Same validation (recordVisitSchema), same visitor_id/path/brand handling,
 * same geo header reading as recordVisit — this is a transport difference,
 * not a second tracking system.
 */
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/track/checkout')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { recordVisitSchema } = await import('#/lib/validation/analytics')
        const { insertStorefrontVisit } =
          await import('#/server/analytics/track')

        // sendBeacon's Blob body and a plain fetch POST body both land
        // here as text — never trust it's valid JSON (a beacon fired
        // during page unload is exactly the kind of request a browser or
        // proxy can truncate).
        let parsed: unknown
        try {
          parsed = JSON.parse(await request.text())
        } catch {
          return new Response('Invalid body', { status: 400 })
        }
        const result = recordVisitSchema.safeParse(parsed)
        if (!result.success) {
          return new Response('Invalid body', { status: 400 })
        }

        // Same best-effort geo read as recordVisit — real headers in
        // production, absent in local dev.
        const country = request.headers.get('x-vercel-ip-country')
        const rawCity = request.headers.get('x-vercel-ip-city')
        const city = rawCity ? decodeURIComponent(rawCity) : null

        await insertStorefrontVisit(result.data, { country, city })
        return Response.json({ ok: true })
      },
    },
  },
})

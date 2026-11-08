import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import type { RecordVisitInput } from '#/lib/validation/analytics'
import {
  recordVisitSchema,
  isValidStorefrontPath,
} from '#/lib/validation/analytics'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'

/**
 * The actual storefront_visits insert, shared by every entry point that
 * writes one — the createServerFn below (page views, the product page's
 * checkout_start) and api/track/checkout.ts's plain POST handler (the
 * checkout funnel events, which need a real HTTP endpoint so
 * navigator.sendBeacon/fetch keepalive can reach it — neither can invoke a
 * createServerFn's own RPC call convention). One insert path, one set of
 * rules, regardless of which of those two reaches it.
 *
 * A `path` that doesn't look like a real storefront page (see
 * isValidStorefrontPath's own doc comment) is silently dropped rather than
 * inserted — same response shape either way, so this gives a direct-POST
 * script nothing to distinguish "rejected" from "recorded" and iterate
 * against. Confirmed live: without this, a script hitting this endpoint
 * directly (no real page load at all) can insert arbitrary junk — this is
 * exactly how thousands/day of fabricated Shopify CDN image paths ended up
 * in storefront_visits, corrupting the visitor/geography dashboards.
 */
export async function insertStorefrontVisit(
  data: RecordVisitInput,
  geo: { country: string | null; city: string | null },
): Promise<{ ok: true }> {
  if (!isValidStorefrontPath(data.path)) return { ok: true }

  const admin = getSupabaseAdminClient()
  const { error } = await admin.from('storefront_visits').insert({
    visitor_id: data.visitorId,
    path: data.path,
    event_type: data.eventType,
    product_id: data.productId,
    metadata: data.metadata,
    brand: data.brand,
    country: geo.country,
    city: geo.city,
  })
  if (error) throw error
  return { ok: true }
}

/**
 * Public, unauthenticated write — called from every storefront page load so
 * the admin Home dashboard can show real visitor/conversion-rate numbers.
 * No session, no PII: `visitorId` is a random id the browser generates and
 * keeps in localStorage, not tied to any customer account.
 */
export const recordVisit = createServerFn({ method: 'POST' })
  .validator(recordVisitSchema)
  .handler(async ({ data }) => {
    // Best-effort — real headers in production, absent in local dev (see
    // server/currency/geo.ts's identical read of the country header).
    // x-vercel-ip-city is URL-encoded (it's a raw header value, and city
    // names can contain spaces/non-ASCII), so it needs decoding.
    const country = getRequestHeader('x-vercel-ip-country') ?? null
    const rawCity = getRequestHeader('x-vercel-ip-city')
    const city = rawCity ? decodeURIComponent(rawCity) : null

    return insertStorefrontVisit(data, { country, city })
  })

import { z } from 'zod'

export const EVENT_TYPES = ['page_view', 'checkout_start'] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const recordVisitSchema = z.object({
  visitorId: z.string().uuid(),
  path: z.string().trim().min(1).max(500),
  eventType: z.enum(EVENT_TYPES).default('page_view'),
  productId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  // Which brand's domain this visit happened on (see
  // server/storefront/domain.ts) — plain string, not that module's Brand
  // enum, to keep this validation module free of a server/ dependency.
  brand: z.string().default('spades'),
})

export type RecordVisitInput = z.infer<typeof recordVisitSchema>

export const recordPresenceSchema = z.object({
  visitorId: z.string().uuid(),
  path: z.string().trim().min(1).max(500),
  brand: z.string().default('spades'),
})

export type RecordPresenceInput = z.infer<typeof recordPresenceSchema>

// Every real top-level route segment across the storefront (see
// src/routes/**, excluding /admin and /api — neither ever calls
// recordVisit). Route structure is identical for Spades/Ysrael/Aspire365:
// brand is resolved from the request's hostname (server/storefront/
// domain.ts), never from the path, so this one list covers all three.
// Deliberately just the stable top-level segment, not every dynamic
// slug/token pattern beneath it (product slugs, order ids, review
// tokens...) — those change constantly; a new top-level section gets
// added maybe once every few months, so this needs updating far less
// often than a full per-route allowlist would.
const KNOWN_TOP_LEVEL_SEGMENTS = new Set([
  'about',
  'account',
  'auth',
  'cart',
  'checkout',
  'collections',
  'contact',
  'products',
  'review',
  'reviews',
  'track',
  'unsubscribe',
])

// Recognizably not a page at all — a static asset, a build artifact, or a
// platform-internal path. TanStack Router's own location.pathname (the
// only legitimate source of this value — see VisitTracker.tsx and
// products/$slug.tsx, both of which read it from router state, never a
// raw string) can never actually take on one of these; a real image/script
// request never goes through client-side routing to begin with.
const NON_PAGE_PREFIXES = ['/cdn', '/_next', '/_vercel', '/api', '/assets', '/admin']
const STATIC_ASSET_EXTENSION_RE =
  /\.(png|jpe?g|gif|webp|svg|ico|heic|heif|bmp|tiff?|avif|js|mjs|css|map|woff2?|ttf|eot|otf|json|xml|txt|pdf|mp4|webm|mov|mp3|wav|zip|csv)$/i

/**
 * Whether `path` could plausibly be a real page a customer's browser
 * navigated to. recordVisit is a public, unauthenticated endpoint, and its
 * only legitimate callers (VisitTracker.tsx, products/$slug.tsx) always
 * send TanStack Router's own location.pathname — so a genuine call always
 * looks like one of these. This is what stands between it and a script
 * directly POSTing arbitrary junk: confirmed live, thousands/day of
 * fabricated Shopify CDN image paths (e.g.
 * "/cdn/shop/products/....png"), each with a freshly-generated visitor
 * id, corrupting the visitor/geography dashboards.
 *
 * Deliberately checks path *shape*, not an exact per-route allowlist — a
 * real "page not found" hit (a stale bookmark, a typo'd URL under a known
 * top-level section) still passes, since only the shape of obviously-fake
 * traffic is rejected, not every path this app doesn't happen to define.
 */
export function isValidStorefrontPath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false
  if (path.includes('://')) return false
  if (path.includes('..')) return false
  // Control characters never appear in a real location.pathname value.
  if (Array.from(path).some((char) => char.charCodeAt(0) < 0x20)) return false

  const withoutQuery = path.split(/[?#]/)[0] ?? path
  if (NON_PAGE_PREFIXES.some((prefix) => withoutQuery.startsWith(prefix))) {
    return false
  }
  if (STATIC_ASSET_EXTENSION_RE.test(withoutQuery)) return false

  const firstSegment = withoutQuery.split('/')[1] ?? ''
  return firstSegment === '' || KNOWN_TOP_LEVEL_SEGMENTS.has(firstSegment)
}

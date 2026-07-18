/**
 * CDN cache policy for public, read-mostly storefront pages (product
 * listing/detail, collections, home) — Vercel's edge caches the SSR
 * response for `s-maxage` seconds, then keeps serving that cached copy for
 * up to `stale-while-revalidate` more seconds while a fresh copy is
 * fetched in the background. `max-age=0` keeps browsers themselves from
 * caching (so back/forward and repeat visits still revalidate against the
 * edge), while the CDN layer absorbs the actual traffic — at real order/
 * visit volume, this takes most page views off the database entirely
 * instead of re-querying on every single request.
 *
 * Deliberately NOT used on cart/checkout/account/admin — anything
 * personalized or mutation-sensitive must stay live.
 */
export const STOREFRONT_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
}

/** Longer-lived policy for pages that essentially never change (About, etc.). */
export const STATIC_CACHE_HEADERS = {
  'Cache-Control':
    'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
}

/**
 * Client-side, short-TTL reuse wrapper around getRootLoaderData.
 *
 * __root.tsx's beforeLoad re-invokes getRootLoaderData on every client-side
 * navigation (TanStack Router caches `loader`s, not `beforeLoad`), even
 * though its contents (storefrontScope, geo, maintenance mode, banner,
 * popup flag) essentially never change within a single browser session.
 * This skips the repeat serverFn round trip for navigations that land
 * within TTL_MS of the last successful resolution — see the
 * getRootLoaderData client-side-reuse audit for the full reasoning on why
 * this is the one option that actually reduces Function Invocations
 * (server-side caching of the fields inside getRootLoaderData already
 * exists and doesn't touch invocation count at all).
 *
 * Server-side (SSR) is completely unaffected — the `typeof window` guard
 * below means a fresh page load always resolves this fully server-side,
 * in-process, exactly as before this file existed. It never even reaches
 * the caching logic.
 *
 * Browser memory only: plain module-scoped variables, reset to empty on
 * every full page load/reload — no localStorage/sessionStorage/cookies
 * involved, and nothing persists across a reload. Inherently scoped to one
 * brand/host too: a single browser tab only ever talks to one storefront
 * domain for its lifetime, so there's no cache key to get wrong and no
 * cross-brand/cross-domain leakage risk.
 */
import { getRootLoaderData } from '#/server/storefront/root-loader'
import type { RootLoaderData } from '#/server/storefront/root-loader'

const TTL_MS = 10_000

let cached: { data: RootLoaderData; resolvedAt: number } | null = null
let inFlight: Promise<RootLoaderData> | null = null

export function getRootLoaderDataCached(): Promise<RootLoaderData> {
  // Initial SSR render — always resolve fresh, in-process. This path never
  // made a separate network request to begin with, so there's nothing to
  // save here, and no `window` to scope a client-side cache to anyway.
  if (typeof window === 'undefined') {
    return getRootLoaderData()
  }

  if (cached && Date.now() - cached.resolvedAt < TTL_MS) {
    return Promise.resolve(cached.data)
  }

  if (inFlight) return inFlight

  inFlight = getRootLoaderData()
    .then((data) => {
      cached = { data, resolvedAt: Date.now() }
      return data
    })
    .finally(() => {
      // Cleared on both success and failure — a failed resolution must
      // never poison `cached` (it's only ever set in the `.then` above) and
      // must never block the next call from retrying fresh.
      inFlight = null
    })

  return inFlight
}

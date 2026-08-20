import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { RouteLoadingIndicator } from '#/components/RouteLoadingIndicator'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    // NOT what fixes hover-then-click double-fetching — this only governs
    // whether *repeating* an intent signal on an already-preloaded link
    // (e.g. hovering it again) re-triggers a fresh preload. Left at
    // TanStack's own default (30s) rather than 0, since re-preloading a
    // link a visitor is still hovering over serves no purpose.
    defaultPreloadStaleTime: 30_000,
    // THIS is what fixes it: a loader's data is reused for `staleTime` ms
    // after it resolves, whether that resolution came from a preload or a
    // real navigation — unset (defaulting to 0), a hover-preload's data was
    // immediately stale by the time the click landed, so every real
    // navigation re-ran the loader from scratch even a moment after the
    // hover had just fetched the same thing (confirmed live: hover, wait
    // 2s, click — full refetch every time at 0). 5s covers a normal
    // hover-then-click gap without meaningfully risking stale price/stock
    // on getProductPageData if a customer instead leaves and comes back
    // after a longer gap (a fresh navigation past 5s still refetches).
    // Only applies to `loader`s, not `beforeLoad` — __root.tsx's
    // beforeLoad (getRootLoaderData) still re-runs every navigation
    // regardless; moving it to a loader would fix that too but reworks
    // how the whole app consumes storefrontScope/maintenanceMode/etc.,
    // out of scope for a preload-only pass.
    defaultStaleTime: 5_000,
    // Navigations with a fast loader shouldn't flash the loading logo at
    // all; ones that take a moment shouldn't flicker it on and off either.
    // These two thresholds (only show after 200ms of waiting, then once
    // shown stay for at least 300ms) come straight from TanStack Router's
    // own defaults for this pattern.
    defaultPendingComponent: RouteLoadingIndicator,
    defaultPendingMs: 200,
    defaultPendingMinMs: 300,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}

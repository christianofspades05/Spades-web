import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { RouteLoadingIndicator } from '#/components/RouteLoadingIndicator'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
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

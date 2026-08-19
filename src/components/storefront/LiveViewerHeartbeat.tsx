import { useEffect } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { recordPresence } from '#/server/analytics/track'
import { getOrCreateVisitorId } from '#/lib/analytics/visitor-id'
import { useVisibleInterval } from '#/lib/hooks/useVisibleInterval'

// Was 20s — this fires on every storefront page for every visitor for as
// long as a tab stays open (background tabs included, see
// useVisibleInterval), so the interval length directly drives request
// volume. A "live viewers" count doesn't need second-by-second freshness.
const HEARTBEAT_MS = 60_000

/**
 * Pings on an interval (not on navigation, unlike VisitTracker) so the admin
 * Home dashboard can show a live viewer count. Renders nothing.
 */
export function LiveViewerHeartbeat({ brand }: { brand: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  function sendPing() {
    if (pathname.startsWith('/admin')) return
    void recordPresence({
      data: { visitorId: getOrCreateVisitorId(), path: pathname, brand },
    })
  }

  // Fires once right away on every navigation (accurate per-page
  // attribution costs nothing extra — it's proportional to real
  // pageviews), then the recurring interval below runs independently of
  // navigation instead of being torn down and restarted on every route
  // change like it used to be.
  useEffect(sendPing, [pathname, brand])
  useVisibleInterval(sendPing, HEARTBEAT_MS)

  return null
}

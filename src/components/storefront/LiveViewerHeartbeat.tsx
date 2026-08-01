import { useEffect } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { recordPresence } from '#/server/analytics/track'
import { getOrCreateVisitorId } from '#/lib/analytics/visitor-id'

const HEARTBEAT_MS = 20_000

/**
 * Pings on an interval (not on navigation, unlike VisitTracker) so the admin
 * Home dashboard can show a live viewer count. Renders nothing.
 */
export function LiveViewerHeartbeat({ brand }: { brand: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  useEffect(() => {
    if (pathname.startsWith('/admin')) return
    const visitorId = getOrCreateVisitorId()
    const ping = () =>
      void recordPresence({ data: { visitorId, path: pathname, brand } })

    ping()
    const id = setInterval(ping, HEARTBEAT_MS)
    return () => clearInterval(id)
  }, [pathname, brand])

  return null
}

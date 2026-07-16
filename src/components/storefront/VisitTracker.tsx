import { useEffect } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { recordVisit } from '#/server/analytics/track'
import { getOrCreateVisitorId } from '#/lib/analytics/visitor-id'

/** Fires a page-view beacon on every route change so the admin Home dashboard can show real visitor/conversion-rate numbers. Renders nothing. */
export function VisitTracker() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  useEffect(() => {
    if (pathname.startsWith('/admin')) return
    const visitorId = getOrCreateVisitorId()
    void recordVisit({ data: { visitorId, path: pathname } })
  }, [pathname])

  return null
}

import { useEffect } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { recordVisit } from '#/server/analytics/track'
import { recordCreatorLinkVisit } from '#/server/analytics/creator-ref'
import { getOrCreateVisitorId } from '#/lib/analytics/visitor-id'

/** Fires a page-view beacon on every route change so the admin Home dashboard can show real visitor/conversion-rate numbers. Renders nothing. */
export function VisitTracker({ brand }: { brand: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  useEffect(() => {
    if (pathname.startsWith('/admin')) return
    const visitorId = getOrCreateVisitorId()
    void recordVisit({ data: { visitorId, path: pathname, brand } })
  }, [pathname, brand])

  // Creator tracking link (?ref=CODE): logged once per code per browser
  // session so a refresh doesn't count as another click; the server sets
  // the 30-day ref cookie checkout reads (server/analytics/creator-ref.ts).
  useEffect(() => {
    if (pathname.startsWith('/admin')) return
    const ref = new URLSearchParams(window.location.search).get('ref')?.trim()
    if (!ref) return
    const key = `spades_ref_logged:${ref.toUpperCase()}`
    try {
      if (window.sessionStorage.getItem(key)) return
      window.sessionStorage.setItem(key, '1')
    } catch {
      // Private mode / blocked storage — log anyway.
    }
    void recordCreatorLinkVisit({
      data: { ref, visitorId: getOrCreateVisitorId(), path: pathname },
    })
  }, [pathname])

  return null
}

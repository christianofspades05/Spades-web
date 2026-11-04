import { useEffect, useRef } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { trackPixelEvent } from '#/lib/analytics/facebook-pixel'
import { captureFbclid } from '#/lib/analytics/fbclid'

/** Fires a PageView on every client-side route change, mirroring VisitTracker. The very first PageView is already fired by the inline bootstrap script in __root.tsx's <head> — this skips that first mount so it isn't double-counted. */
export function FacebookPixelPageView() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (pathname.startsWith('/admin')) return
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    trackPixelEvent('PageView')
  }, [pathname])

  return null
}

/** Captures `fbclid` for order attribution on every page load/navigation
 *  (unlike FacebookPixelPageView above, this does NOT skip the first
 *  mount — the first load is exactly when an ad click's fbclid shows up
 *  in the URL). See lib/analytics/fbclid.ts for the storage/window rules. */
export function FbclidCapture() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const search = useRouterState({ select: (s) => s.location.searchStr })

  useEffect(() => {
    if (pathname.startsWith('/admin')) return
    captureFbclid(search)
  }, [pathname, search])

  return null
}

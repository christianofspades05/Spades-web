import { useEffect, useRef } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { trackPixelEvent } from '#/lib/analytics/facebook-pixel'

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

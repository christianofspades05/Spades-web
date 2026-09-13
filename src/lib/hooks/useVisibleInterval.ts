import { useEffect, useRef } from 'react'

/**
 * Like setInterval, but skips firing while the tab isn't visible (a
 * background/inactive tab), and fires one fresh call as soon as it becomes
 * visible again so the data doesn't sit stale. Written for polling loops
 * that would otherwise keep hitting the server indefinitely in a tab
 * nobody is actually looking at — originally added for the storefront's
 * live-presence heartbeat (a cost audit traced a large share of Vercel's
 * Edge Request/Function Invocation volume to exactly this: a site-wide
 * interval with no visibility gating). That heartbeat has since been
 * removed entirely, but the hook is still used by admin.tsx's unread-
 * replies polling.
 *
 * Does NOT fire on mount — callers that want an immediate first call
 * should still do that themselves, same as before this hook existed.
 */
export function useVisibleInterval(callback: () => void, ms: number): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    function tick() {
      if (document.visibilityState === 'visible') callbackRef.current()
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') callbackRef.current()
    }

    const id = setInterval(tick, ms)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [ms])
}

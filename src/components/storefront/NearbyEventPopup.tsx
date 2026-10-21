import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { getNearbyEventCandidates } from '#/server/events/queries'
import type { NearbyEventCandidate } from '#/server/events/queries'
import { buttonPrimaryClassName } from '#/components/storefront/ui'

const RADIUS_KM = 5
/** How long to back off after a visitor declines the soft "see events near
 *  you?" ask, or after geolocation fails/is denied — re-asking every page
 *  load would be a nag. */
const DECLINE_BACKOFF_DAYS = 7
const DECLINE_STORAGE_KEY = 'nearby_event_popup_declined_at'
const SHOWN_EVENT_STORAGE_PREFIX = 'nearby_event_popup_shown_'

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function recentlyDeclined(): boolean {
  const raw = localStorage.getItem(DECLINE_STORAGE_KEY)
  if (!raw) return false
  const declinedAt = Number(raw)
  if (!Number.isFinite(declinedAt)) return false
  return Date.now() - declinedAt < DECLINE_BACKOFF_DAYS * 24 * 60 * 60 * 1000
}

function markDeclined(): void {
  localStorage.setItem(DECLINE_STORAGE_KEY, String(Date.now()))
}

/**
 * Spades-only (gated at the mount site, __root.tsx). Two-step, consent-
 * driven flow rather than firing the browser's geolocation permission
 * prompt unprompted on page load — that's both a jarring first impression
 * and something mobile browsers increasingly throttle/block for requests
 * not tied to a user gesture:
 *   1. A small corner ask: "See Spades events happening near you?"
 *   2. Only on "Yes" does this call navigator.geolocation — a real click,
 *      satisfying that gesture requirement — and only then do we learn
 *      the visitor's position to check distance at all.
 * Declining (or a denied/failed geolocation call) backs off for
 * DECLINE_BACKOFF_DAYS; actually seeing the "there's an event near you"
 * result backs off for that specific event only, so a second nearby event
 * later can still prompt.
 */
export function NearbyEventPopup() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [stage, setStage] = useState<'hidden' | 'ask' | 'result'>('hidden')
  const [matchedEvent, setMatchedEvent] = useState<NearbyEventCandidate | null>(
    null,
  )
  const [locating, setLocating] = useState(false)

  // Hides the floating widget on /events (already there) and /admin
  // (gated again here, not just at the __root.tsx mount site, since this
  // component stays mounted across client-side navigations) — checked at
  // render time, not inside the effect below, so navigating away from
  // /events can still reveal an ask that already resolved in the
  // background.
  const hideOnThisPage =
    pathname.startsWith('/events') || pathname.startsWith('/admin')

  useEffect(() => {
    if (!('geolocation' in navigator)) return
    if (recentlyDeclined()) return

    let cancelled = false
    void getNearbyEventCandidates().then((candidates) => {
      if (cancelled || candidates.length === 0) return
      setStage('ask')
    })
    return () => {
      cancelled = true
    }
    // Deliberately runs once per mount, not once per navigation — fetching
    // the small candidate list is cheap and harmless from any page.
  }, [])

  function decline() {
    markDeclined()
    setStage('hidden')
  }

  async function allow() {
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const candidates = await getNearbyEventCandidates()
          const { latitude, longitude } = position.coords
          let nearest: NearbyEventCandidate | null = null
          let nearestKm = Infinity
          for (const candidate of candidates) {
            const km = haversineKm(
              latitude,
              longitude,
              candidate.latitude,
              candidate.longitude,
            )
            if (km < nearestKm) {
              nearestKm = km
              nearest = candidate
            }
          }
          if (
            nearest &&
            nearestKm <= RADIUS_KM &&
            !localStorage.getItem(
              `${SHOWN_EVENT_STORAGE_PREFIX}${nearest.slug}`,
            )
          ) {
            setMatchedEvent(nearest)
            setStage('result')
          } else {
            setStage('hidden')
          }
        } finally {
          setLocating(false)
        }
      },
      () => {
        // Denied or failed — same backoff as an explicit "no".
        markDeclined()
        setLocating(false)
        setStage('hidden')
      },
      { timeout: 10_000 },
    )
  }

  function dismissResult() {
    if (matchedEvent) {
      localStorage.setItem(
        `${SHOWN_EVENT_STORAGE_PREFIX}${matchedEvent.slug}`,
        '1',
      )
    }
    setStage('hidden')
  }

  if (stage === 'hidden' || hideOnThisPage) return null

  return (
    <div className="fixed right-4 bottom-4 z-50 w-full max-w-xs rounded-lg border border-neutral-200 bg-white p-4 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
      {stage === 'ask' ? (
        <>
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
            See Spades events happening near you?
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void allow()}
              disabled={locating}
              className={`${buttonPrimaryClassName} flex-1 justify-center`}
            >
              {locating ? 'Checking…' : 'Yes'}
            </button>
            <button
              type="button"
              onClick={decline}
              className="flex-1 rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Not now
            </button>
          </div>
        </>
      ) : (
        matchedEvent && (
          <div className="relative pr-5">
            <button
              type="button"
              onClick={dismissResult}
              aria-label="Dismiss"
              className="absolute top-0 right-0 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              <X size={16} />
            </button>
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
              There's a Spades event near you!
            </p>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              {matchedEvent.name} — join the community.
            </p>
            <Link
              to="/events/$slug"
              params={{ slug: matchedEvent.slug }}
              onClick={dismissResult}
              className={`${buttonPrimaryClassName} mt-3 w-full justify-center`}
            >
              View event
            </Link>
          </div>
        )
      )}
    </div>
  )
}

const STORAGE_KEY = 'spades_fbclid'
const ATTRIBUTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

interface StoredFbclid {
  fbclid: string
  capturedAt: number
}

/** First-click attribution: captures `fbclid` from the URL on landing and
 *  keeps it for 30 days so a later order (even one placed after further,
 *  fbclid-less visits) can still be credited to the ad that first brought
 *  the visitor in. Never overwrites an existing, still-valid capture —
 *  the FIRST ad click wins, not the most recent page load. */
export function captureFbclid(search: string): void {
  const fbclid = new URLSearchParams(search).get('fbclid')
  if (!fbclid) return
  if (readStoredFbclid()) return

  const stored: StoredFbclid = { fbclid, capturedAt: Date.now() }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
}

function readStoredFbclid(): StoredFbclid | null {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  const parsed = JSON.parse(raw) as StoredFbclid
  if (Date.now() - parsed.capturedAt > ATTRIBUTION_WINDOW_MS) {
    window.localStorage.removeItem(STORAGE_KEY)
    return null
  }
  return parsed
}

/** The fbclid to attach to an order at checkout, or null once it's expired
 *  (30 days past capture) or was never captured this browser. */
export function getAttributedFbclid(): string | null {
  return readStoredFbclid()?.fbclid ?? null
}

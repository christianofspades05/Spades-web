/**
 * Lazily loads the Google Maps JavaScript API (+ Places library) exactly
 * once per page, no matter how many components request it. Powers the
 * Lalamove checkout address picker (see components/storefront/
 * LalamoveAddressPicker.tsx / LalamoveGoogleMap.tsx).
 *
 * Must only ever be called client-side (inside a useEffect) — it appends a
 * <script> tag, which has no meaning during SSR. Safe to import this module
 * itself anywhere though: defining the function has no side effects on its
 * own, only calling it does.
 */
let loadPromise: Promise<void> | null = null

export function loadGoogleMaps(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('loadGoogleMaps() called during SSR'))
  }
  if (typeof google !== 'undefined') return Promise.resolve()
  if (loadPromise) return loadPromise

  loadPromise = new Promise((resolve, reject) => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as
      | string
      | undefined
    if (!apiKey) {
      reject(new Error('Missing VITE_GOOGLE_MAPS_API_KEY'))
      return
    }
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`
    script.async = true
    script.onload = () => resolve()
    script.onerror = () =>
      reject(new Error('Failed to load the Google Maps script'))
    document.head.appendChild(script)
  })
  return loadPromise
}

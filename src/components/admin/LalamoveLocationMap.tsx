/**
 * Browser-only Google Map showing a fixed, non-draggable marker at the
 * customer's checkout pin — staff can visually confirm it before booking,
 * but can't accidentally move it (unlike the storefront's editable picker).
 * Must only ever be reached via a dynamic `import()` after
 * lib/google-maps/loader.ts's script has finished loading, same reasoning
 * as components/storefront/LalamoveGoogleMap.tsx.
 */
import { useEffect, useRef } from 'react'

export default function LalamoveLocationMap({
  lat,
  lng,
}: {
  lat: number
  lng: number
}) {
  const mapDivRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!mapDivRef.current) return
    const position = { lat, lng }

    const map = new google.maps.Map(mapDivRef.current, {
      center: position,
      zoom: 16,
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: false,
    })
    const marker = new google.maps.Marker({ map, position })

    return () => {
      google.maps.event.clearInstanceListeners(marker)
      google.maps.event.clearInstanceListeners(map)
      marker.setMap(null)
    }
  }, [lat, lng])

  return (
    <div
      ref={mapDivRef}
      style={{ height: '220px', width: '100%', borderRadius: '0.5rem' }}
    />
  )
}

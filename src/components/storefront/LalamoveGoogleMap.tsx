/**
 * Browser-only Google Map + draggable marker. This module assumes
 * `google.maps` is already loaded (see lib/google-maps/loader.ts) — it must
 * only ever be reached via a dynamic `import()` after that resolves, never
 * imported statically, since constructing anything from the `google`
 * global before the script has loaded would throw.
 */
import { useEffect, useRef } from 'react'

export interface LatLng {
  lat: number
  lng: number
}

export default function LalamoveGoogleMap({
  center,
  markerPosition,
  onMarkerMove,
}: {
  center: LatLng
  markerPosition: LatLng | null
  onMarkerMove: (lat: number, lng: number) => void
}) {
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const markerRef = useRef<google.maps.Marker | null>(null)

  // Map + marker are created once and then driven imperatively (below) —
  // recreating them every render would drop the user's in-progress drag.
  useEffect(() => {
    if (!mapDivRef.current) return

    const map = new google.maps.Map(mapDivRef.current, {
      center,
      zoom: 16,
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: false,
    })
    mapRef.current = map

    const marker = new google.maps.Marker({
      map,
      position: markerPosition ?? center,
      draggable: true,
    })
    marker.addListener('dragend', () => {
      const pos = marker.getPosition()
      if (pos) onMarkerMove(pos.lat(), pos.lng())
    })
    map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (e.latLng) onMarkerMove(e.latLng.lat(), e.latLng.lng())
    })
    markerRef.current = marker

    return () => {
      google.maps.event.clearInstanceListeners(marker)
      google.maps.event.clearInstanceListeners(map)
      marker.setMap(null)
    }
  }, [])

  useEffect(() => {
    mapRef.current?.panTo(center)
  }, [center])

  useEffect(() => {
    if (markerPosition) markerRef.current?.setPosition(markerPosition)
  }, [markerPosition])

  return (
    <div
      ref={mapDivRef}
      style={{ height: '280px', width: '100%', borderRadius: '0.5rem' }}
    />
  )
}

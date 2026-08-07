import { useEffect, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { loadGoogleMaps } from '#/lib/google-maps/loader'
import { inputClassName, labelClassName } from '#/components/storefront/ui'

export interface LalamovePin {
  lat: number
  lng: number
}

type GoogleMapComponent = ComponentType<{
  center: LalamovePin
  markerPosition: LalamovePin | null
  onMarkerMove: (lat: number, lng: number) => void
}>

const DEFAULT_CENTER: LalamovePin = { lat: 14.5995, lng: 120.9842 }

/** Lets the customer search for or drag a delivery pin for the Lalamove
 *  quotation, backed by Google Maps + Places Autocomplete. The map itself
 *  lives in a sibling browser-only module (LalamoveGoogleMap), loaded via
 *  dynamic import only after the Google Maps script has finished loading —
 *  neither should ever touch window/document during SSR. */
export function LalamoveAddressPicker({
  pin,
  onPinChange,
  searchHint,
}: {
  pin: LalamovePin | null
  onPinChange: (pin: LalamovePin) => void
  /** Typed address fields — geocoded once to pre-fill the pin the first
   *  time this picker appears, not kept in sync with further edits
   *  afterward (the customer may be refining the search box themselves by
   *  then). */
  searchHint: string
}) {
  const [MapComponent, setMapComponent] = useState<GoogleMapComponent | null>(
    null,
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [center, setCenter] = useState<LalamovePin>(pin ?? DEFAULT_CENTER)
  const inputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null)
  const geocodedHint = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadGoogleMaps()
      .then(() => import('#/components/storefront/LalamoveGoogleMap'))
      .then((mod) => {
        if (!cancelled) setMapComponent(() => mod.default)
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(
            'Could not load the map. Please refresh the page, or contact us if this keeps happening.',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Binds the Places Autocomplete widget to the search input once the
  // script is ready — Google injects its own suggestion dropdown into
  // document.body, no extra markup/styling needed on our end.
  useEffect(() => {
    if (!MapComponent || !inputRef.current || autocompleteRef.current) return
    const autocomplete = new google.maps.places.Autocomplete(
      inputRef.current,
      { componentRestrictions: { country: 'ph' }, fields: ['geometry'] },
    )
    autocomplete.addListener('place_changed', () => {
      const location = autocomplete.getPlace().geometry?.location
      if (!location) return
      const next = { lat: location.lat(), lng: location.lng() }
      setCenter(next)
      onPinChange(next)
    })
    autocompleteRef.current = autocomplete
  }, [MapComponent, onPinChange])

  // Auto-geocodes the typed checkout address once, the first time this
  // picker appears with no pin set yet — the customer can still search or
  // drag to correct it afterward.
  useEffect(() => {
    if (
      !MapComponent ||
      pin ||
      geocodedHint.current === searchHint ||
      !searchHint.trim()
    ) {
      return
    }
    geocodedHint.current = searchHint
    new google.maps.Geocoder()
      .geocode({
        address: searchHint,
        componentRestrictions: { country: 'PH' },
      })
      .then((result) => {
        if (result.results.length === 0) return
        const location = result.results[0].geometry.location
        const next = { lat: location.lat(), lng: location.lng() }
        setCenter(next)
        onPinChange(next)
      })
      .catch(() => {
        // Best-effort pre-fill only — the customer can still search or drag
        // the pin manually if this fails.
      })
  }, [MapComponent, searchHint, pin, onPinChange])

  return (
    <div className="space-y-2">
      <p className={labelClassName}>
        Delivery pin
        <span className="text-xs font-normal text-neutral-500 dark:text-neutral-400">
          Search your address or drag the pin to your exact delivery location
          — this is what the Lalamove rider will navigate to.
        </span>
      </p>
      <input
        ref={inputRef}
        type="text"
        defaultValue={searchHint}
        placeholder="Search an address"
        className={`${inputClassName} w-full`}
      />
      {loadError && <p className="text-xs text-red-600">{loadError}</p>}
      {MapComponent ? (
        <MapComponent
          center={center}
          markerPosition={pin}
          onMarkerMove={(lat, lng) => onPinChange({ lat, lng })}
        />
      ) : (
        !loadError && (
          <div className="flex h-[280px] w-full items-center justify-center rounded-md bg-neutral-100 text-sm text-neutral-400 dark:bg-neutral-900">
            Loading map…
          </div>
        )
      )}
      {/* TEMP debug readout — remove once the pickup coordinates are
       *  finalized in .env (see LALAMOVE_PICKUP_LAT/LNG). */}
      {import.meta.env.DEV && pin && (
        <p className="font-mono text-xs text-neutral-400">
          DEBUG pin: {pin.lat}, {pin.lng}
        </p>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import {
  bookLalamoveShipment,
  createShipmentPhotoUploadUrl,
  refreshLalamoveStatus,
  setShipmentPickupPhoto,
  upsertShipment,
} from '#/server/admin/orders'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import { loadGoogleMaps } from '#/lib/google-maps/loader'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { Card } from '#/components/admin/Card'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/admin/ui'
import type { LalamoveInfo } from '#/types/database.types'

type LocationMapComponent = ComponentType<{ lat: number; lng: number }>

/** Loaded once per panel instance, same dynamic-import-after-script-load
 *  reasoning as storefront/LalamoveAddressPicker.tsx. */
function useLalamoveLocationMap() {
  const [MapComponent, setMapComponent] =
    useState<LocationMapComponent | null>(null)

  useEffect(() => {
    let cancelled = false
    loadGoogleMaps()
      .then(() => import('#/components/admin/LalamoveLocationMap'))
      .then((mod) => {
        if (!cancelled) setMapComponent(() => mod.default)
      })
      .catch(() => {
        // Best-effort only — the address text below still lets staff book
        // without the map if it fails to load.
      })
    return () => {
      cancelled = true
    }
  }, [])

  return MapComponent
}

/** The customer's checkout pin, shown for the whole life of a Lalamove
 *  order — unlike LalamoveBookingPanel below, this isn't specific to the
 *  pre-booking step, so staff can still see (and visually confirm) where
 *  the order actually went after it's booked/fulfilled, not just before. */
export function LalamoveLocationCard({
  lalamoveInfo,
}: {
  lalamoveInfo: LalamoveInfo
}) {
  const MapComponent = useLalamoveLocationMap()

  return (
    <Card className="p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Lalamove Delivery
      </h2>
      <p className="text-sm text-neutral-900">{lalamoveInfo.dropoffAddress}</p>
      {MapComponent && (
        <div className="mt-3">
          <MapComponent
            lat={lalamoveInfo.dropoffLat}
            lng={lalamoveInfo.dropoffLng}
          />
        </div>
      )}
    </Card>
  )
}

/** Staff's "confirm and book" action for a paid Lalamove order — shown in
 *  place of the plain ShipmentForm until a shipments row actually exists
 *  (see bookLalamoveShipment in server/admin/orders.ts for why booking and
 *  shipment-row-creation happen together). Pickup contact isn't fixed —
 *  staff enter it fresh each booking. Reused by both the order detail page
 *  and the admin Lalamove Orders list. */
export function LalamoveBookingPanel({
  orderId,
  lalamoveInfo,
  onBooked,
}: {
  orderId: string
  lalamoveInfo: LalamoveInfo
  onBooked: () => void
}) {
  const [pickupContactName, setPickupContactName] = useState('')
  const [pickupContactPhone, setPickupContactPhone] = useState('')
  const [booking, setBooking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Some staff book the rider directly in Lalamove's own app/dashboard
  // (e.g. to pick a service tier or handle an edge case this panel's live
  // API call doesn't support) rather than through "Book Lalamove Rider"
  // above — this lets them paste that trip's tracking link straight in,
  // going through the same upsertShipment path (and customer email) as a
  // normal courier, instead of being stuck with no way to mark it shipped.
  const [manualEntry, setManualEntry] = useState(false)
  const [trackingNumber, setTrackingNumber] = useState('')
  const [trackingUrl, setTrackingUrl] = useState('')
  const [savingManual, setSavingManual] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)

  async function handleBook(event: React.FormEvent) {
    event.preventDefault()
    setBooking(true)
    setError(null)
    try {
      await bookLalamoveShipment({
        data: { orderId, pickupContactName, pickupContactPhone },
      })
      onBooked()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBooking(false)
    }
  }

  async function handleManualSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSavingManual(true)
    setManualError(null)
    try {
      await upsertShipment({
        data: {
          orderId,
          carrier: 'lalamove',
          trackingNumber,
          trackingUrl: trackingUrl || undefined,
          status: 'in_transit',
        },
      })
      onBooked()
    } catch (err) {
      setManualError(getErrorMessage(err))
    } finally {
      setSavingManual(false)
    }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Book Rider
      </h2>
      <p className="text-xs text-neutral-500">
        Customer already paid an estimated fee of{' '}
        {formatCentsAsPHP(lalamoveInfo.estimatedFeeCents)} at checkout. The
        actual fee is re-quoted right before booking — any small difference
        is absorbed by the store, nothing more is collected from the
        customer or recipient.
      </p>

      <form onSubmit={handleBook} className="mt-4 space-y-3">
        <label className={labelClassName}>
          Pickup contact name
          <input
            required
            value={pickupContactName}
            onChange={(e) => setPickupContactName(e.target.value)}
            className={inputClassName}
          />
        </label>
        <label className={labelClassName}>
          Pickup contact phone
          <input
            required
            placeholder="09171234567"
            value={pickupContactPhone}
            onChange={(e) => setPickupContactPhone(e.target.value)}
            className={inputClassName}
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={booking}
          className={buttonPrimaryClassName}
        >
          {booking ? 'Booking…' : 'Book Lalamove Rider'}
        </button>
      </form>

      {!manualEntry ? (
        <button
          type="button"
          onClick={() => setManualEntry(true)}
          className="mt-3 text-xs text-neutral-500 underline hover:text-neutral-700"
        >
          Already booked this rider directly in Lalamove? Paste the tracking
          link instead
        </button>
      ) : (
        <form
          onSubmit={handleManualSubmit}
          className="mt-4 space-y-3 border-t border-neutral-200 pt-4"
        >
          <label className={labelClassName}>
            Tracking number
            <input
              required
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              className={inputClassName}
            />
          </label>
          <label className={labelClassName}>
            Tracking link
            <input
              value={trackingUrl}
              onChange={(e) => setTrackingUrl(e.target.value)}
              placeholder="https://share.lalamove.com/..."
              className={inputClassName}
            />
          </label>
          {manualError && (
            <p className="text-sm text-red-600">{manualError}</p>
          )}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={savingManual}
              className={buttonSecondaryClassName}
            >
              {savingManual ? 'Saving…' : 'Save tracking link'}
            </button>
            <button
              type="button"
              onClick={() => setManualEntry(false)}
              className="text-xs text-neutral-500 underline hover:text-neutral-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </Card>
  )
}

/** No incoming Lalamove webhook is wired up yet — this pulls the latest
 *  status/driver info from Lalamove's API on demand instead. */
export function LalamoveRefreshButton({
  orderId,
  onRefreshed,
}: {
  orderId: string
  onRefreshed: () => void
}) {
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRefresh() {
    setRefreshing(true)
    setError(null)
    try {
      await refreshLalamoveStatus({ data: { orderId } })
      onRefreshed()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="-mt-2">
      <button
        type="button"
        onClick={handleRefresh}
        disabled={refreshing}
        className={buttonSecondaryClassName}
      >
        {refreshing ? 'Refreshing…' : 'Refresh Lalamove status'}
      </button>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  )
}

/** Staff photographs the package when the rider arrives to pick it up and
 *  uploads it here — saved on the shipment and emailed to the customer
 *  immediately as pickup confirmation. Only meaningful once a shipment
 *  exists (there's nothing to photograph before a rider is booked), unlike
 *  LalamoveLocationCard above which spans the whole order lifecycle. */
export function LalamovePickupPhotoCard({
  orderId,
  photoUrl,
  onUploaded,
}: {
  orderId: string
  photoUrl: string | null
  onUploaded: () => void
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const { path, token, publicUrl } = await createShipmentPhotoUploadUrl({
        data: { fileName: file.name },
      })
      const { error: uploadError } = await getSupabaseBrowserClient()
        .storage.from('shipment-photos')
        .uploadToSignedUrl(path, token, file)
      if (uploadError) throw uploadError
      await setShipmentPickupPhoto({ data: { orderId, photoUrl: publicUrl } })
      onUploaded()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Pickup Photo
      </h2>
      <p className="mb-3 text-xs text-neutral-500">
        Photograph the package when the rider picks it up — uploading emails
        it to the customer right away as pickup confirmation.
      </p>
      {photoUrl && (
        <img
          src={photoUrl}
          alt="Package at pickup"
          className="mb-3 w-full max-w-xs rounded-lg border border-neutral-200"
        />
      )}
      <label
        className={`${buttonSecondaryClassName} ${uploading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
      >
        {uploading
          ? 'Uploading…'
          : photoUrl
            ? 'Replace photo'
            : 'Upload photo'}
        <input
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          disabled={uploading}
          className="hidden"
        />
      </label>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Card>
  )
}

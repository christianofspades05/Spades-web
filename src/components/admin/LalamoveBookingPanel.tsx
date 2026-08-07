import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import {
  bookLalamoveShipment,
  refreshLalamoveStatus,
} from '#/server/admin/orders'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import { loadGoogleMaps } from '#/lib/google-maps/loader'
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
  const MapComponent = useLalamoveLocationMap()

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
      <p className="mt-1 text-xs text-neutral-500">
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

import { useState } from 'react'
import { createEventImageUploadUrl } from '#/server/admin/events'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { resizeImageFile } from '#/lib/utils/file'
import {
  storeLocalDateTimeToUtcIso,
  utcIsoToStoreLocalDateTimeInput,
} from '#/lib/utils/date-range'
import { centsToPesos } from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import type { EventInput } from '#/lib/validation/events'
import type { CommunityEventRow } from '#/types/community-events'
import { Card } from '#/components/admin/Card'
import {
  buttonPrimaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/admin/ui'

export function EventForm({
  event,
  onSubmit,
  submitLabel,
}: {
  event?: CommunityEventRow
  onSubmit: (data: EventInput) => Promise<void>
  submitLabel: string
}) {
  const [name, setName] = useState(event?.name ?? '')
  const [locationName, setLocationName] = useState(event?.location_name ?? '')
  const [locationMapUrl, setLocationMapUrl] = useState(
    event?.location_map_url ?? '',
  )
  const [imageUrl, setImageUrl] = useState(event?.image_url ?? '')
  const [latitude, setLatitude] = useState(
    event?.latitude != null ? String(event.latitude) : '',
  )
  const [longitude, setLongitude] = useState(
    event?.longitude != null ? String(event.longitude) : '',
  )
  const [locating, setLocating] = useState(false)
  const [startsAt, setStartsAt] = useState(
    event ? utcIsoToStoreLocalDateTimeInput(event.starts_at) : '',
  )
  const [endsAt, setEndsAt] = useState(
    event ? utcIsoToStoreLocalDateTimeInput(event.ends_at) : '',
  )
  const [totalSlots, setTotalSlots] = useState(String(event?.total_slots ?? 20))
  const [feePesos, setFeePesos] = useState(
    event ? String(centsToPesos(event.fee_cents)) : '0',
  )
  const [isActive, setIsActive] = useState(event?.is_active ?? true)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleImageUpload(file: File) {
    setUploading(true)
    setError(null)
    try {
      const resized = await resizeImageFile(file, 2000)
      const { path, token, publicUrl } = await createEventImageUploadUrl({
        data: { fileName: resized.name },
      })
      const { error: uploadError } = await getSupabaseBrowserClient()
        .storage.from('community-events')
        .uploadToSignedUrl(path, token, resized)
      if (uploadError) throw uploadError
      setImageUrl(publicUrl)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit(formEvent: React.FormEvent) {
    formEvent.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        name,
        locationName,
        locationMapUrl,
        imageUrl,
        latitude: latitude ? Number(latitude) : undefined,
        longitude: longitude ? Number(longitude) : undefined,
        startsAt: storeLocalDateTimeToUtcIso(startsAt),
        endsAt: storeLocalDateTimeToUtcIso(endsAt),
        totalSlots: Number(totalSlots),
        feePesos: Number(feePesos),
        isActive,
      })
    } catch (err) {
      setError(getErrorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div>
          <label className={labelClassName}>Event name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={`${inputClassName} w-full`}
          />
        </div>

        <div>
          <label className={labelClassName}>Banner image</label>
          {imageUrl && (
            <img
              src={imageUrl}
              alt=""
              className="mb-2 aspect-square w-full max-w-xs rounded-md border border-neutral-200 object-cover"
            />
          )}
          <input
            type="file"
            accept="image/*"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleImageUpload(file)
            }}
            className="text-sm"
          />
          {uploading && (
            <p className="mt-1 text-xs text-neutral-500">Uploading…</p>
          )}
        </div>

        <div>
          <label className={labelClassName}>Place</label>
          <input
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
            placeholder="e.g. Spades Flagship Store, Makati"
            required
            className={`${inputClassName} w-full`}
          />
        </div>

        <div>
          <label className={labelClassName}>Google Maps link (optional)</label>
          <input
            type="url"
            value={locationMapUrl}
            onChange={(e) => setLocationMapUrl(e.target.value)}
            placeholder="https://maps.google.com/..."
            className={`${inputClassName} w-full`}
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className={labelClassName}>
              Coordinates (optional — powers the "event near you" popup)
            </label>
            <button
              type="button"
              disabled={locating}
              onClick={() => {
                setLocating(true)
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    setLatitude(String(pos.coords.latitude))
                    setLongitude(String(pos.coords.longitude))
                    setLocating(false)
                  },
                  () => setLocating(false),
                )
              }}
              className="text-xs font-medium text-neutral-600 underline hover:text-neutral-900"
            >
              {locating ? 'Locating…' : 'Use my current location'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <input
              type="number"
              step="any"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              placeholder="Latitude"
              className={`${inputClassName} w-full`}
            />
            <input
              type="number"
              step="any"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              placeholder="Longitude"
              className={`${inputClassName} w-full`}
            />
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            Leave blank to skip the proximity popup for this event. "Use my
            current location" only makes sense if you're at the venue right now.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClassName}>Starts</label>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              required
              className={`${inputClassName} w-full`}
            />
          </div>
          <div>
            <label className={labelClassName}>Ends</label>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              required
              className={`${inputClassName} w-full`}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClassName}>Number of slots</label>
            <input
              type="number"
              min={1}
              value={totalSlots}
              onChange={(e) => setTotalSlots(e.target.value)}
              required
              className={`${inputClassName} w-full`}
            />
          </div>
          <div>
            <label className={labelClassName}>Fee (₱, 0 = free)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={feePesos}
              onChange={(e) => setFeePesos(e.target.value)}
              required
              className={`${inputClassName} w-full`}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Active (visible on the storefront)
        </label>

        <button
          type="submit"
          disabled={submitting || uploading}
          className={buttonPrimaryClassName}
        >
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </form>
    </Card>
  )
}

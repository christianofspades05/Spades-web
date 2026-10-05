import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  createCodRestrictedCity,
  deleteCodRestrictedCity,
  listCodRestrictedCities,
  setCodRestrictedCityActive,
} from '#/server/admin/cod-restricted-cities'
import type { CodRestrictedCityInput } from '#/lib/validation/admin/cod-restricted-cities'
import { RegionProvinceCitySelect } from '#/components/admin/RegionProvinceCitySelect'
import type { RegionProvinceCityValue } from '#/components/admin/RegionProvinceCitySelect'
import { ncrProvinceFallback, formatRegionLabel } from '#/lib/utils/ph-region'
import { getErrorMessage } from '#/lib/utils/errors'
import { PageHeader } from '#/components/admin/PageHeader'
import { Badge } from '#/components/admin/Badge'
import { Card } from '#/components/admin/Card'
import {
  buttonDangerClassName,
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
  labelClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'
import type { CodRestrictedCity } from '#/types/entities'

export const Route = createFileRoute('/admin/cod-cities/')({
  loader: () => listCodRestrictedCities(),
  component: CodCitiesPage,
})

function CodCitiesPage() {
  const cities = Route.useLoaderData()
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="COD Restrictions"
        subtitle="Block Cash on Delivery for specific cities/municipalities with a history of high returns or failed deliveries from our couriers. Not absolute — a returning customer with at least one paid order successfully delivered, and no failed deliveries, is still allowed COD even in a blocked city."
        action={
          !showForm && (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className={buttonPrimaryClassName}
            >
              Add city
            </button>
          )
        }
      />

      {showForm && (
        <AddCityForm
          onAdded={() => {
            setShowForm(false)
            router.invalidate()
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div className={`${tableWrapperClassName} mt-4`}>
        {cities.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">
            No restrictions yet. Cash on Delivery is available everywhere in
            the Philippines.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClassName}>City / Municipality</th>
                  <th className={tableHeadClassName}>Province</th>
                  <th className={tableHeadClassName}>Region</th>
                  <th className={tableHeadClassName}>Reason</th>
                  <th className={tableHeadClassName}>Status</th>
                  <th className={tableHeadClassName} />
                </tr>
              </thead>
              <tbody>
                {cities.map((city) => (
                  <CityRow
                    key={city.id}
                    city={city}
                    onChanged={() => router.invalidate()}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function AddCityForm({
  onAdded,
  onCancel,
}: {
  onAdded: () => void
  onCancel: () => void
}) {
  const [value, setValue] = useState<RegionProvinceCityValue>({
    region: '',
    province: '',
    city: '',
  })
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const input: CodRestrictedCityInput = {
        region: value.region,
        // NCR has no real province in the PSGC data — same fallback
        // checkout itself applies (CheckoutContext's withSubmittableProvince),
        // so a restriction saved here actually matches what place-order.ts
        // sees for an NCR address.
        province: ncrProvinceFallback(value.region, value.province),
        city: value.city,
        reason: reason.trim() || undefined,
      }
      await createCodRestrictedCity({ data: input })
      onAdded()
    } catch (err) {
      setError(getErrorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <Card className="mt-4 p-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <RegionProvinceCitySelect value={value} onChange={setValue} />

        <label className={labelClassName}>
          Reason (optional, shown to the customer at checkout)
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. High rate of failed deliveries in this area"
            className={inputClassName}
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting || !value.city}
            className={buttonPrimaryClassName}
          >
            {submitting ? 'Saving…' : 'Block Cash on Delivery here'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className={buttonSecondaryClassName}
          >
            Cancel
          </button>
        </div>
      </form>
    </Card>
  )
}

function CityRow({
  city,
  onChanged,
}: {
  city: CodRestrictedCity
  onChanged: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggleActive() {
    setSubmitting(true)
    setError(null)
    try {
      await setCodRestrictedCityActive({
        data: { id: city.id, isActive: !city.is_active },
      })
      onChanged()
    } catch (err) {
      setError(getErrorMessage(err))
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Remove the Cash on Delivery block for ${city.city}?`)) return
    setSubmitting(true)
    setError(null)
    try {
      await deleteCodRestrictedCity({ data: { id: city.id } })
      onChanged()
    } catch (err) {
      setError(getErrorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <tr className={tableRowClassName}>
      <td className={tableCellClassName}>{city.city}</td>
      <td className={`${tableCellClassName} text-neutral-500`}>
        {city.province}
      </td>
      <td className={`${tableCellClassName} text-neutral-500`}>
        {formatRegionLabel(city.region)}
      </td>
      <td className={`${tableCellClassName} text-neutral-500`}>
        {city.reason ?? '—'}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </td>
      <td className={tableCellClassName}>
        <Badge tone={city.is_active ? 'success' : 'neutral'}>
          {city.is_active ? 'Blocked' : 'Inactive'}
        </Badge>
      </td>
      <td className={`${tableCellClassName} text-right`}>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={toggleActive}
            className={buttonSecondaryClassName}
          >
            {city.is_active ? 'Deactivate' : 'Reactivate'}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleDelete}
            className={buttonDangerClassName}
          >
            Remove
          </button>
        </div>
      </td>
    </tr>
  )
}

import { useState } from 'react'
import { getErrorMessage } from '#/lib/utils/errors'
import type { MarketPricingInput } from '#/lib/validation/admin/market-pricing'
import { COUNTRIES } from '#/lib/utils/countries'
import { Card } from '#/components/admin/Card'
import {
  buttonPrimaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/admin/ui'
import type { MarketPricing } from '#/types/entities'

export function MarketPricingForm({
  market,
  onSubmit,
  submitLabel,
}: {
  market?: MarketPricing
  onSubmit: (data: MarketPricingInput) => Promise<void>
  submitLabel: string
}) {
  const [countryCode, setCountryCode] = useState(
    market?.country_code ?? COUNTRIES[0].code,
  )
  const [markupPercent, setMarkupPercent] = useState(
    market ? String(market.markup_percent) : '',
  )
  const [isActive, setIsActive] = useState(market?.is_active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        countryCode,
        markupPercent: Number(markupPercent),
        isActive,
      })
    } catch (err) {
      setError(getErrorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className={labelClassName}>
          Country
          <select
            required
            disabled={Boolean(market)}
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            className={inputClassName}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          {market && (
            <span className="text-xs font-normal text-neutral-500">
              Country can't be changed after creation — create a new entry
              instead.
            </span>
          )}
        </label>

        <label className={labelClassName}>
          Markup (%)
          <input
            required
            type="number"
            min={0}
            max={500}
            step="0.01"
            value={markupPercent}
            onChange={(e) => setMarkupPercent(e.target.value)}
            placeholder="e.g. 15"
            className={inputClassName}
          />
          <span className="text-xs font-normal text-neutral-500">
            Applied to the product subtotal only — never to shipping. A ₱747
            cart at 15% becomes ₱859.05 for the products; shipping is added on
            top unchanged.
          </span>
        </label>

        <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Active
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className={buttonPrimaryClassName}
        >
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </form>
    </Card>
  )
}

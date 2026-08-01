import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { getErrorMessage } from '#/lib/utils/errors'
import type { MarketInput } from '#/lib/validation/admin/market-pricing'
import { COUNTRIES, formatCountryName } from '#/lib/utils/countries'
import { Card } from '#/components/admin/Card'
import {
  buttonPrimaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/admin/ui'
import type { MarketWithCountries } from '#/types/entities'

export function MarketPricingForm({
  market,
  takenCountryCodes,
  onSubmit,
  submitLabel,
}: {
  market?: MarketWithCountries
  /** Country codes already assigned to a *different* market — offered but
   *  disabled, so staff sees why a country can't be picked here instead of
   *  it just silently not showing up. */
  takenCountryCodes: string[]
  onSubmit: (data: MarketInput) => Promise<void>
  submitLabel: string
}) {
  const [countryCodes, setCountryCodes] = useState<string[]>(
    market?.countryCodes ?? [],
  )
  const [query, setQuery] = useState('')
  const [markupPercent, setMarkupPercent] = useState(
    market ? String(market.markup_percent) : '',
  )
  const [isActive, setIsActive] = useState(market?.is_active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const takenSet = useMemo(
    () => new Set(takenCountryCodes),
    [takenCountryCodes],
  )

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (!trimmed) return COUNTRIES
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(trimmed))
  }, [query])

  function toggleCountry(code: string) {
    setCountryCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    )
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        countryCodes,
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
        <div>
          <label className={labelClassName}>Countries</label>

          {countryCodes.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {countryCodes.map((code) => (
                <span
                  key={code}
                  className="inline-flex items-center gap-1 rounded-full bg-neutral-100 py-0.5 pr-1 pl-2.5 text-xs font-medium text-neutral-700"
                >
                  {formatCountryName(code)}
                  <button
                    type="button"
                    onClick={() => toggleCountry(code)}
                    aria-label={`Remove ${formatCountryName(code)}`}
                    className="rounded-full p-0.5 hover:bg-neutral-200"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search countries to add…"
            className={`${inputClassName} w-full`}
          />
          <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-neutral-200">
            {filtered.length === 0 && (
              <p className="p-3 text-sm text-neutral-400">No countries found</p>
            )}
            {filtered.map((c) => {
              const selected = countryCodes.includes(c.code)
              const taken = takenSet.has(c.code) && !selected
              return (
                <label
                  key={c.code}
                  className={`flex items-center gap-2 border-b border-neutral-100 px-3 py-1.5 text-sm last:border-b-0 ${
                    taken
                      ? 'cursor-not-allowed text-neutral-400'
                      : 'cursor-pointer text-neutral-700 hover:bg-neutral-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={taken}
                    onChange={() => toggleCountry(c.code)}
                  />
                  {c.name}
                  {taken && (
                    <span className="ml-auto text-xs">
                      already in another market
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        </div>

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
            top unchanged. Every selected country shares this same rate.
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
          disabled={submitting || countryCodes.length === 0}
          className={buttonPrimaryClassName}
        >
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </form>
    </Card>
  )
}

import { useState } from 'react'
import { centsToPesos } from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import type { DiscountInput } from '#/lib/validation/admin/discounts'
import { Card } from '#/components/admin/Card'
import {
  buttonPrimaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/admin/ui'
import type { Collection, Discount } from '#/types/entities'

export function DiscountForm({
  discount,
  collections,
  lockKind,
  onSubmit,
  submitLabel,
}: {
  discount?: Discount
  collections: Collection[]
  lockKind: boolean
  onSubmit: (data: DiscountInput) => Promise<void>
  submitLabel: string
}) {
  const [kind, setKind] = useState<'code' | 'automatic'>(
    discount?.kind ?? 'code',
  )
  const [title, setTitle] = useState(discount?.title ?? '')
  const [code, setCode] = useState(discount?.code ?? '')
  const [discountType, setDiscountType] = useState<
    'percentage' | 'fixed_amount'
  >(discount?.type === 'fixed_amount' ? 'fixed_amount' : 'percentage')
  const [percentageValue, setPercentageValue] = useState(
    discount?.type === 'percentage' ? discount.value : 10,
  )
  const [amountPesos, setAmountPesos] = useState(
    discount?.type === 'fixed_amount' ? centsToPesos(discount.value) : 0,
  )
  const [startsAt, setStartsAt] = useState(
    discount?.starts_at ? toLocalInput(discount.starts_at) : '',
  )
  const [endsAt, setEndsAt] = useState(
    discount?.ends_at ? toLocalInput(discount.ends_at) : '',
  )
  const [maxUses, setMaxUses] = useState<number | ''>(discount?.max_uses ?? '')
  const [oneUsePerCustomer, setOneUsePerCustomer] = useState(
    discount?.max_uses_per_customer === 1,
  )
  const [isActive, setIsActive] = useState(discount?.is_active ?? true)
  const [excludedCollectionIds, setExcludedCollectionIds] = useState<string[]>(
    discount?.excluded_collection_ids ?? [],
  )
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function toggleExcluded(id: string) {
    setExcludedCollectionIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    )
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        kind,
        title,
        code: kind === 'code' ? code : undefined,
        discountType,
        percentageValue:
          discountType === 'percentage' ? percentageValue : undefined,
        amountPesos: discountType === 'fixed_amount' ? amountPesos : undefined,
        startsAt: startsAt || undefined,
        endsAt: endsAt || undefined,
        maxUses: maxUses === '' ? undefined : maxUses,
        oneUsePerCustomer,
        isActive,
        excludedCollectionIds:
          kind === 'automatic' ? excludedCollectionIds : [],
      })
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-neutral-700">
            Discount method
          </legend>
          <label className="flex items-start gap-2 text-sm text-neutral-700">
            <input
              type="radio"
              name="kind"
              disabled={lockKind}
              checked={kind === 'code'}
              onChange={() => setKind('code')}
              className="mt-1"
            />
            <span>
              <span className="font-medium text-neutral-900">
                Discount code
              </span>{' '}
              — customers enter a code at checkout to redeem it.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-neutral-700">
            <input
              type="radio"
              name="kind"
              disabled={lockKind}
              checked={kind === 'automatic'}
              onChange={() => setKind('automatic')}
              className="mt-1"
            />
            <span>
              <span className="font-medium text-neutral-900">Store sale</span> —
              applies automatically to the whole store, no code needed. Can
              exclude specific collections.
            </span>
          </label>
        </fieldset>

        <label className={labelClassName}>
          Title
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === 'code' ? 'e.g. Summer10' : 'e.g. Summer Sale'}
            className={inputClassName}
          />
        </label>

        {kind === 'code' && (
          <label className={labelClassName}>
            Code
            <input
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. SUMMER10"
              className={`${inputClassName} uppercase`}
            />
            <span className="text-xs font-normal text-neutral-500">
              What customers type at checkout. Saved in uppercase.
            </span>
          </label>
        )}

        <div className="flex gap-4">
          <label className="flex-1 text-sm font-medium text-neutral-700">
            Value
            <div className="mt-1 flex gap-2">
              <select
                value={discountType}
                onChange={(e) =>
                  setDiscountType(
                    e.target.value as 'percentage' | 'fixed_amount',
                  )
                }
                className={inputClassName}
              >
                <option value="percentage">Percentage</option>
                <option value="fixed_amount">Fixed amount</option>
              </select>
              {discountType === 'percentage' ? (
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={percentageValue}
                    onChange={(e) => setPercentageValue(Number(e.target.value))}
                    className={`${inputClassName} w-24`}
                  />
                  <span className="text-neutral-500">%</span>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <span className="text-neutral-400">₱</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={amountPesos}
                    onChange={(e) => setAmountPesos(Number(e.target.value))}
                    className={`${inputClassName} w-28`}
                  />
                </div>
              )}
            </div>
          </label>
        </div>

        <div className="flex gap-4">
          <label className={`flex-1 ${labelClassName}`}>
            {kind === 'automatic' ? 'Starts' : 'Starts (optional)'}
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className={inputClassName}
            />
          </label>
          <label className={`flex-1 ${labelClassName}`}>
            {kind === 'automatic' ? 'Ends' : 'Expires (optional)'}
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className={inputClassName}
            />
          </label>
        </div>

        {kind === 'code' && (
          <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4">
            <p className="text-sm font-medium text-neutral-900">Usage limits</p>
            <label className={labelClassName}>
              Total usage limit
              <input
                type="number"
                min="1"
                value={maxUses}
                onChange={(e) =>
                  setMaxUses(
                    e.target.value === '' ? '' : Number(e.target.value),
                  )
                }
                placeholder="No limit"
                className={`${inputClassName} w-32`}
              />
              <span className="text-xs font-normal text-neutral-500">
                Leave blank for unlimited uses.
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={oneUsePerCustomer}
                onChange={(e) => setOneUsePerCustomer(e.target.checked)}
              />
              Limit to one use per customer
            </label>
          </div>
        )}

        {kind === 'automatic' && collections.length > 0 && (
          <fieldset className="flex flex-col gap-1 rounded-lg border border-neutral-200 p-4">
            <legend className="mb-1 text-sm font-medium text-neutral-900">
              Exclude collections from this sale
            </legend>
            {collections.map((collection) => (
              <label
                key={collection.id}
                className="flex items-center gap-2 text-sm text-neutral-700"
              >
                <input
                  type="checkbox"
                  checked={excludedCollectionIds.includes(collection.id)}
                  onChange={() => toggleExcluded(collection.id)}
                />
                {collection.name}
              </label>
            ))}
          </fieldset>
        )}

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

function toLocalInput(isoString: string): string {
  const date = new Date(isoString)
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - offset * 60_000)
  return local.toISOString().slice(0, 16)
}

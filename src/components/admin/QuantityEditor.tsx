import { Check } from 'lucide-react'
import { useState } from 'react'
import { adjustInventory } from '#/server/admin/products'
import { getErrorMessage } from '#/lib/utils/errors'
import { buttonPrimaryClassName, inputClassName } from '#/components/admin/ui'

/** Quick edit of a variant's *available* stock — the only number staff
 *  should need to think about (on-hand and reserved-by-active-carts are
 *  internal bookkeeping that used to be shown side by side and confused
 *  staff about which one they were actually changing). Since reserved is
 *  untouched by this edit, a change of N in desired availability is always
 *  exactly a change of N to on-hand (available = on_hand - reserved), so
 *  the same delta this always computed still goes through the audited
 *  adjustInventory path unchanged. `variant="pill"` is the compact,
 *  rounded-pill look used by the mobile inventory list (see
 *  InventoryCard.tsx); the default keeps the existing boxed-input look used
 *  everywhere else. */
export function QuantityEditor({
  variantId,
  availableQuantity,
  onSaved,
  variant = 'default',
}: {
  variantId: string
  availableQuantity: number
  onSaved: () => void
  variant?: 'default' | 'pill'
}) {
  const [value, setValue] = useState(availableQuantity)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = value !== availableQuantity

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await adjustInventory({
        data: { variantId, quantityDelta: value - availableQuantity },
      })
      onSaved()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (variant === 'pill') {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1">
          <input
            type="number"
            min="0"
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            className="w-16 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-center text-sm font-medium text-neutral-900 focus:border-neutral-500 focus:outline-none"
          />
          {dirty && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              aria-label="Save quantity"
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white disabled:opacity-50"
            >
              <Check size={14} />
            </button>
          )}
        </div>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min="0"
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        className={`${inputClassName} w-20`}
      />
      {dirty && (
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={`${buttonPrimaryClassName} px-2 py-1 text-xs`}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}

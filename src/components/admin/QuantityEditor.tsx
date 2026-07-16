import { useState } from 'react'
import { adjustInventory } from '#/server/admin/products'
import { getErrorMessage } from '#/lib/utils/errors'
import { buttonPrimaryClassName, inputClassName } from '#/components/admin/ui'

/** Quick absolute-quantity edit — computes the delta under the hood so stock changes still go through the audited adjustInventory path. */
export function QuantityEditor({
  variantId,
  quantity,
  onSaved,
}: {
  variantId: string
  quantity: number
  onSaved: () => void
}) {
  const [value, setValue] = useState(quantity)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = value !== quantity

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await adjustInventory({
        data: { variantId, quantityDelta: value - quantity },
      })
      onSaved()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
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

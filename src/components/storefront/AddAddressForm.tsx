import { useState } from 'react'
import { addCustomerAddress } from '#/server/account/addresses'
import { getErrorMessage } from '#/lib/utils/errors'
import { PHAddressFields } from '#/components/storefront/PHAddressFields'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/storefront/ui'

interface AddressFormState {
  label: string
  recipientName: string
  phone: string
  region: string
  province: string
  city: string
  barangay: string
  postalCode: string
  addressLine1: string
  addressLine2: string
  landmark: string
  isDefaultShipping: boolean
  isDefaultBilling: boolean
}

const EMPTY_FORM: AddressFormState = {
  label: '',
  recipientName: '',
  phone: '',
  region: '',
  province: '',
  city: '',
  barangay: '',
  postalCode: '',
  addressLine1: '',
  addressLine2: '',
  landmark: '',
  isDefaultShipping: false,
  isDefaultBilling: false,
}

export function AddAddressForm({
  onAdded,
  onCancel,
}: {
  onAdded: () => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<AddressFormState>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await addCustomerAddress({
        data: {
          label: form.label || undefined,
          recipientName: form.recipientName,
          phone: form.phone,
          region: form.region,
          province: form.province,
          city: form.city,
          barangay: form.barangay,
          postalCode: form.postalCode || undefined,
          addressLine1: form.addressLine1,
          addressLine2: form.addressLine2 || undefined,
          landmark: form.landmark || undefined,
          isDefaultShipping: form.isDefaultShipping,
          isDefaultBilling: form.isDefaultBilling,
        },
      })
      onAdded()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 flex flex-col gap-4 rounded-lg border border-neutral-200 p-5 dark:border-neutral-800"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClassName}>
          Label (optional)
          <input
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="Home, Office…"
            className={inputClassName}
          />
        </label>
        <label className={labelClassName}>
          Recipient name
          <input
            required
            value={form.recipientName}
            onChange={(e) =>
              setForm({ ...form, recipientName: e.target.value })
            }
            className={inputClassName}
          />
        </label>
      </div>

      <label className={labelClassName}>
        Phone
        <input
          required
          placeholder="09171234567"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          className={inputClassName}
        />
      </label>

      <PHAddressFields
        value={{
          region: form.region,
          province: form.province,
          city: form.city,
          barangay: form.barangay,
        }}
        onChange={(addr) => setForm({ ...form, ...addr })}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClassName}>
          Address line 1
          <input
            required
            placeholder="House/unit no., street"
            value={form.addressLine1}
            onChange={(e) => setForm({ ...form, addressLine1: e.target.value })}
            className={inputClassName}
          />
        </label>
        <label className={labelClassName}>
          Address line 2 (optional)
          <input
            value={form.addressLine2}
            onChange={(e) => setForm({ ...form, addressLine2: e.target.value })}
            className={inputClassName}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClassName}>
          Landmark (optional)
          <input
            value={form.landmark}
            onChange={(e) => setForm({ ...form, landmark: e.target.value })}
            className={inputClassName}
          />
        </label>
        <label className={labelClassName}>
          Postal code (optional)
          <input
            value={form.postalCode}
            onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
            className={inputClassName}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input
            type="checkbox"
            checked={form.isDefaultShipping}
            onChange={(e) =>
              setForm({ ...form, isDefaultShipping: e.target.checked })
            }
          />
          Default shipping address
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
          <input
            type="checkbox"
            checked={form.isDefaultBilling}
            onChange={(e) =>
              setForm({ ...form, isDefaultBilling: e.target.checked })
            }
          />
          Default billing address
        </label>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className={buttonPrimaryClassName}
        >
          {submitting ? 'Saving…' : 'Save address'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={buttonSecondaryClassName}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

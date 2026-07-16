import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  createStaffUser,
  listStaffUsers,
  setStaffUserActive,
} from '#/server/admin/settings'
import type { StaffAccount } from '#/server/admin/settings'
import { STAFF_ROLES } from '#/lib/validation/admin/settings'
import { getErrorMessage } from '#/lib/utils/errors'
import { PageHeader } from '#/components/admin/PageHeader'
import { Badge } from '#/components/admin/Badge'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
  labelClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

export const Route = createFileRoute('/admin/settings/')({
  loader: () => listStaffUsers(),
  component: SettingsPage,
})

function SettingsPage() {
  const staff = Route.useLoaderData()
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="w-full px-8 py-10">
      <PageHeader title="Settings" subtitle="Manage staff accounts" />

      <div className="mt-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900">
          Staff accounts
        </h2>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className={buttonPrimaryClassName}
          >
            Add staff
          </button>
        )}
      </div>

      {showForm && (
        <AddStaffForm
          onAdded={() => {
            setShowForm(false)
            router.invalidate()
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div className={`${tableWrapperClassName} mt-4`}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={tableHeadClassName}>Name</th>
              <th className={tableHeadClassName}>Email</th>
              <th className={tableHeadClassName}>Role</th>
              <th className={tableHeadClassName}>Status</th>
              <th className={tableHeadClassName} />
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <StaffRow
                key={s.id}
                staff={s}
                onChanged={() => router.invalidate()}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StaffRow({
  staff,
  onChanged,
}: {
  staff: StaffAccount
  onChanged: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggleActive() {
    setSubmitting(true)
    setError(null)
    try {
      await setStaffUserActive({
        data: { staffUserId: staff.id, isActive: !staff.is_active },
      })
      onChanged()
    } catch (err) {
      setError(getErrorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <tr className={tableRowClassName}>
      <td className={tableCellClassName}>{staff.full_name}</td>
      <td className={tableCellClassName}>{staff.email}</td>
      <td className={`${tableCellClassName} capitalize`}>
        {staff.role.replace(/_/g, ' ')}
      </td>
      <td className={tableCellClassName}>
        <Badge tone={staff.is_active ? 'success' : 'neutral'}>
          {staff.is_active ? 'Active' : 'Deactivated'}
        </Badge>
      </td>
      <td className={`${tableCellClassName} text-right`}>
        <button
          type="button"
          disabled={submitting}
          onClick={toggleActive}
          className={buttonSecondaryClassName}
        >
          {staff.is_active ? 'Deactivate' : 'Reactivate'}
        </button>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </td>
    </tr>
  )
}

function AddStaffForm({
  onAdded,
  onCancel,
}: {
  onAdded: () => void
  onCancel: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<(typeof STAFF_ROLES)[number]>('support')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await createStaffUser({ data: { email, password, fullName, role } })
      onAdded()
    } catch (err) {
      setError(getErrorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-5"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClassName}>
          Full name
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={inputClassName}
          />
        </label>
        <label className={labelClassName}>
          Role
          <select
            value={role}
            onChange={(e) =>
              setRole(e.target.value as (typeof STAFF_ROLES)[number])
            }
            className={inputClassName}
          >
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClassName}>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClassName}
          />
        </label>
        <label className={labelClassName}>
          Password
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClassName}
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className={buttonPrimaryClassName}
        >
          {submitting ? 'Adding…' : 'Add staff'}
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

import { useState } from 'react'
import {
  createCreatorPortalAccount,
  resetCreatorPortalPassword,
} from '#/server/admin/creators'
import { buttonPrimaryClassName, inputClassName, labelClassName } from './ui'
import type { Creator } from '#/types/creators'

export function CreatorPortalAccessCard({
  creator,
  hasPortalAccount,
  canManage,
  onSaved,
}: {
  creator: Creator
  hasPortalAccount: boolean
  canManage: boolean
  onSaved: () => Promise<void>
}) {
  const [email, setEmail] = useState(creator.email ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  if (!canManage) return null

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (hasPortalAccount) {
        await resetCreatorPortalPassword({
          data: { creatorId: creator.id, newPassword: password },
        })
        setNotice('Password reset — share the new password with the creator.')
      } else {
        await createCreatorPortalAccount({
          data: { creatorId: creator.id, email, password },
        })
        setNotice(
          'Portal account created — share the email and password with the creator.',
        )
      }
      setPassword('')
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 grid gap-4 rounded-lg border bg-white p-5 sm:grid-cols-2"
    >
      <div className="sm:col-span-2">
        <h2 className="text-sm font-semibold text-neutral-900">
          Creator portal login
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          {hasPortalAccount
            ? `This creator can sign in at /creator/login with ${creator.email ?? 'their email'} to see their own code usage and commissions.`
            : 'Create a login so this creator can sign in and see their own code usage and commissions, without needing to ask staff.'}
        </p>
      </div>
      {!hasPortalAccount && (
        <label className={labelClassName}>
          Login email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClassName}
          />
        </label>
      )}
      <label className={labelClassName}>
        {hasPortalAccount ? 'New password' : 'Password'}
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClassName}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-green-700 sm:col-span-2">
          {notice}
        </p>
      )}
      <button disabled={busy} className={buttonPrimaryClassName}>
        {busy
          ? 'Saving…'
          : hasPortalAccount
            ? 'Reset password'
            : 'Create portal account'}
      </button>
    </form>
  )
}

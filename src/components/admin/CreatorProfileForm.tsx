import { useState } from 'react'
import { creatorCommand } from '#/server/admin/creators'
import { buttonPrimaryClassName, inputClassName } from './ui'
import type { Creator } from '#/types/creators'

export function CreatorProfileForm({
  creator,
  onSaved,
}: {
  creator?: Creator
  onSaved: (id: string) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <form
      className="grid gap-4 rounded-lg border bg-white p-5 sm:grid-cols-2"
      onSubmit={async (event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        setBusy(true)
        setError('')
        try {
          const { id } = await creatorCommand({
            data: {
              action: 'save_creator',
              creatorId: creator?.id,
              name: String(form.get('name')),
              email: String(form.get('email')),
              socialUrl: String(form.get('socialUrl')),
              notes: String(form.get('notes')),
              isActive: form.get('active') === 'on',
            },
          })
          await onSaved(id)
        } catch (err) {
          setError(
            err instanceof Error ? err.message : 'Unable to save creator',
          )
        } finally {
          setBusy(false)
        }
      }}
    >
      <label className="text-sm">
        Name
        <input
          name="name"
          required
          maxLength={200}
          defaultValue={creator?.name}
          className={inputClassName}
        />
      </label>
      <label className="text-sm">
        Email
        <input
          name="email"
          type="email"
          defaultValue={creator?.email ?? ''}
          className={inputClassName}
        />
      </label>
      <label className="text-sm sm:col-span-2">
        Social profile URL
        <input
          name="socialUrl"
          type="url"
          defaultValue={creator?.social_url ?? ''}
          className={inputClassName}
        />
      </label>
      <label className="text-sm sm:col-span-2">
        Notes
        <textarea
          name="notes"
          maxLength={4000}
          defaultValue={creator?.notes ?? ''}
          className={inputClassName}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          name="active"
          type="checkbox"
          defaultChecked={creator?.is_active ?? true}
        />
        Active
      </label>
      <button disabled={busy} className={buttonPrimaryClassName}>
        {busy ? 'Saving…' : 'Save creator'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2">
          {error}
        </p>
      )}
    </form>
  )
}

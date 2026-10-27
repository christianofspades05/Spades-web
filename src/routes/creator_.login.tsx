import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { getCreatorSession } from '#/server/creator/auth'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { getErrorMessage } from '#/lib/utils/errors'
import { Card } from '#/components/admin/Card'
import {
  buttonPrimaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/admin/ui'

export const Route = createFileRoute('/creator_/login')({
  component: CreatorLoginPage,
})

function CreatorLoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const { error: signInError } =
        await getSupabaseBrowserClient().auth.signInWithPassword({
          email,
          password,
        })

      if (signInError) {
        setError(signInError.message)
        setSubmitting(false)
        return
      }

      // A valid Supabase login (e.g. a staff member's own saved password)
      // can still not be a creator — beforeLoad on /creator would just
      // redirect straight back here, leaving this page stuck on "Signing
      // in…" forever since it never actually navigates away. Check first
      // so that case gets a real error instead of a silent hang. Deliberately
      // does NOT sign out here — this browser's one Supabase session is
      // shared with /admin, so signing out here would also kill a staff
      // member's own admin session if they happened to test this page
      // with their own saved login.
      const creator = await getCreatorSession()
      if (!creator) {
        setError('This account does not have creator portal access.')
        setSubmitting(false)
        return
      }

      await navigate({ to: '/creator' })
    } catch (err) {
      setError(getErrorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-6">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-lg font-black tracking-tight">
          SPADES
        </p>
        <Card className="p-6">
          <h1 className="text-lg font-semibold text-neutral-900">
            Creator sign in
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Sign in with the email and password staff gave you to see your own
            code's usage and commissions.
          </p>
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClassName}
              />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className={`${buttonPrimaryClassName} w-full justify-center`}
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </Card>
      </div>
    </div>
  )
}

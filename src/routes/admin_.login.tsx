import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { bootstrapFirstStaffUser, hasAnyStaffUser } from '#/server/admin/auth'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { getErrorMessage } from '#/lib/utils/errors'
import { Card } from '#/components/admin/Card'
import {
  buttonPrimaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/admin/ui'

export const Route = createFileRoute('/admin_/login')({
  loader: () => hasAnyStaffUser(),
  component: AdminLoginPage,
})

function AdminLoginPage() {
  const hasStaff = Route.useLoaderData()

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-6">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-lg font-black tracking-tight">
          SPADES
        </p>
        <Card className="p-6">
          <h1 className="text-lg font-semibold text-neutral-900">
            {hasStaff ? 'Staff sign in' : 'Create the first admin account'}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {hasStaff
              ? 'Sign in with your staff account to manage products and orders.'
              : 'No admin account exists yet. Create one now — this form disappears once an account exists.'}
          </p>
          <div className="mt-6">
            {hasStaff ? <SignInForm /> : <BootstrapForm />}
          </div>
        </Card>
      </div>
    </div>
  )
}

function SignInForm() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

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

    await navigate({ to: '/admin' })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
  )
}

function BootstrapForm() {
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      await bootstrapFirstStaffUser({ data: { fullName, email, password } })
    } catch (err) {
      setError(getErrorMessage(err))
      setSubmitting(false)
      return
    }

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

    await navigate({ to: '/admin' })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className={`${buttonPrimaryClassName} w-full justify-center`}
      >
        {submitting ? 'Creating…' : 'Create admin account'}
      </button>
    </form>
  )
}

import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { GoogleButton } from '#/components/storefront/GoogleButton'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/storefront/ui'

export const Route = createFileRoute('/account/login')({
  component: LoginPage,
})

function LoginPage() {
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
      // Supabase refuses sign-in until the email is confirmed — send them
      // to finish that instead of just showing a raw error.
      if (signInError.message.toLowerCase().includes('confirm')) {
        await navigate({ to: '/account/verify', search: { email } })
        return
      }
      setError(signInError.message)
      setSubmitting(false)
      return
    }

    await navigate({ to: '/account' })
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2">
      {/* Sign up */}
      <div className="flex flex-col items-center justify-center bg-neutral-950 px-8 py-20 text-center text-white md:min-h-[70vh]">
        <h2 className="text-2xl font-bold tracking-tight">
          Don't have an account?
        </h2>
        <p className="mt-3 max-w-xs text-sm text-neutral-300">
          Create one to track your orders, save your addresses, and check out
          faster next time.
        </p>
        <Link
          to="/account/signup"
          className={`${buttonSecondaryClassName} mt-6`}
        >
          Create an account
        </Link>
      </div>

      {/* Sign in */}
      <div className="flex flex-col justify-center px-8 py-16 md:min-h-[70vh]">
        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            Already have an account? Sign in below.
          </p>

          <div className="mt-6">
            <GoogleButton />
          </div>

          <div className="my-6 flex items-center gap-3 text-xs text-neutral-400">
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
            OR
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
          </div>

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
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className={`${buttonPrimaryClassName} w-full justify-center`}
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

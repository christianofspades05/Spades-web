import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { sendWelcomeEmailIfDue } from '#/server/account/welcome-email'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import { GoogleButton } from '#/components/storefront/GoogleButton'
import { PasswordInput } from '#/components/storefront/PasswordInput'
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
  const { t } = useLanguage()
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

    // Idempotent (no-op after the first real send) — a retry point in case
    // it failed at verify.tsx's own first-login attempt, not the primary
    // trigger.
    try {
      await sendWelcomeEmailIfDue()
    } catch {
      // Swallowed deliberately.
    }

    await navigate({ to: '/account' })
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2">
      {/* Sign up */}
      <div className="flex flex-col items-center justify-center bg-neutral-950 px-8 py-20 text-center text-white md:min-h-[70vh]">
        <h2 className="text-2xl font-bold tracking-tight">
          {t.account.noAccountHeading}
        </h2>
        <p className="mt-3 max-w-xs text-sm text-neutral-300">
          {t.account.noAccountBody}
        </p>
        <Link
          to="/account/signup"
          className={`${buttonSecondaryClassName} mt-6`}
        >
          {t.account.createAccount}
        </Link>
      </div>

      {/* Sign in */}
      <div className="flex flex-col justify-center px-8 py-16 md:min-h-[70vh]">
        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-2xl font-bold tracking-tight">
            {t.account.signIn}
          </h1>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            {t.account.alreadyHaveAccount}
          </p>

          <div className="mt-6">
            <GoogleButton label={t.account.continueWithGoogle} />
          </div>

          <div className="my-6 flex items-center gap-3 text-xs text-neutral-400">
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
            {t.account.or}
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className={labelClassName}>
              {t.checkout.email}
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClassName}
              />
            </label>
            <label className={labelClassName}>
              {t.account.password}
              <PasswordInput
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
              />
            </label>
            <Link
              to="/account/forgot-password"
              className="-mt-2 self-end text-xs text-neutral-500 underline hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              {t.account.forgotPassword}
            </Link>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className={`${buttonPrimaryClassName} w-full justify-center`}
            >
              {submitting ? t.account.signingIn : t.account.signIn}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import { GoogleButton } from '#/components/storefront/GoogleButton'
import { PasswordInput } from '#/components/storefront/PasswordInput'
import {
  buttonPrimaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/storefront/ui'

export const Route = createFileRoute('/account/signup')({
  component: SignupPage,
})

function SignupPage() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    // Passed through to the handle_new_auth_user() trigger via
    // raw_user_meta_data, same mechanism full_name already uses — see
    // 0035_email_marketing.sql. Can't be changed once set (enforced by a DB
    // trigger, not just this form), since it's asked for exactly once here.
    const { error: signUpError } = await getSupabaseBrowserClient().auth.signUp(
      { email, password, options: { data: { date_of_birth: dateOfBirth } } },
    )

    if (signUpError) {
      setError(signUpError.message)
      setSubmitting(false)
      return
    }

    await navigate({ to: '/account/verify', search: { email } })
  }

  return (
    <div className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight">
        {t.account.createAccount}
      </h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        {t.account.alreadyHaveOne}{' '}
        <Link to="/account/login" className="underline">
          {t.account.signIn}
        </Link>
      </p>

      <div className="mt-6">
        <GoogleButton label={t.account.signUpWithGoogle} />
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
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        <label className={labelClassName}>
          {t.account.dateOfBirth}
          <input
            type="date"
            required
            max={new Date().toISOString().slice(0, 10)}
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            className={inputClassName}
          />
          <span className="text-xs font-normal text-neutral-400">
            {t.account.dobImmutable}
          </span>
        </label>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className={`${buttonPrimaryClassName} w-full justify-center`}
        >
          {submitting ? t.account.creatingAccount : t.account.createAccount}
        </button>
      </form>
    </div>
  )
}

import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import {
  buttonPrimaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/storefront/ui'

export const Route = createFileRoute('/account/forgot-password')({
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const { t } = useLanguage()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    // Supabase always returns success here regardless of whether the email
    // is registered, to avoid leaking which emails have accounts — sent
    // reflects "we asked Supabase to send it," not "an email exists."
    const { error: resetError } =
      await getSupabaseBrowserClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/account/reset-password`,
      })

    if (resetError) {
      setError(resetError.message)
      setSubmitting(false)
      return
    }

    setSent(true)
    setSubmitting(false)
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-sm px-6 py-16">
        <h1 className="text-2xl font-bold tracking-tight">
          {t.account.checkYourEmail}
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {t.account.resetLinkSentBody}
        </p>
        <Link
          to="/account/login"
          className="mt-6 inline-block text-sm underline"
        >
          {t.account.backToLogin}
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight">
        {t.account.forgotPasswordHeading}
      </h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        {t.account.forgotPasswordBody}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
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
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className={`${buttonPrimaryClassName} w-full justify-center`}
        >
          {submitting ? t.account.sendingResetLink : t.account.sendResetLink}
        </button>
        <Link
          to="/account/login"
          className="text-center text-sm underline text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          {t.account.backToLogin}
        </Link>
      </form>
    </div>
  )
}

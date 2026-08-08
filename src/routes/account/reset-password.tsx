import { useEffect, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { useLanguage } from '#/lib/i18n/LanguageContext'
import { PasswordInput } from '#/components/storefront/PasswordInput'
import { buttonPrimaryClassName, labelClassName } from '#/components/storefront/ui'

export const Route = createFileRoute('/account/reset-password')({
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [linkInvalid, setLinkInvalid] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    // @supabase/ssr's browser client auto-detects the recovery token in this
    // page's URL on init and exchanges it for a temporary session — same
    // mechanism as routes/auth/callback.tsx's OAuth handling. Only once that
    // lands can updateUser() actually change the password.
    const supabase = getSupabaseBrowserClient()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setReady(true)
    })

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true)
    })

    const timeout = setTimeout(() => {
      setReady((alreadyReady) => {
        if (!alreadyReady) setLinkInvalid(true)
        return alreadyReady
      })
    }, 8000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError(t.account.passwordsDontMatch)
      return
    }

    setSubmitting(true)
    const { error: updateError } =
      await getSupabaseBrowserClient().auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setSubmitting(false)
      return
    }

    await navigate({ to: '/account' })
  }

  if (linkInvalid) {
    return (
      <div className="mx-auto max-w-sm px-6 py-16 text-center">
        <h1 className="text-xl font-bold">{t.account.resetLinkExpired}</h1>
        <Link
          to="/account/forgot-password"
          className="mt-6 inline-block text-sm underline"
        >
          {t.account.forgotPassword}
        </Link>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="mx-auto max-w-sm px-6 py-16 text-center text-neutral-500 dark:text-neutral-400">
        {t.account.verifying}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight">
        {t.account.setNewPasswordHeading}
      </h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        {t.account.setNewPasswordBody}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <label className={labelClassName}>
          {t.account.newPassword}
          <PasswordInput
            value={password}
            onChange={setPassword}
            minLength={8}
            autoComplete="new-password"
          />
        </label>
        <label className={labelClassName}>
          {t.account.confirmNewPassword}
          <PasswordInput
            value={confirmPassword}
            onChange={setConfirmPassword}
            minLength={8}
            autoComplete="new-password"
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
          {submitting ? t.account.updatingPassword : t.account.updatePassword}
        </button>
      </form>
    </div>
  )
}

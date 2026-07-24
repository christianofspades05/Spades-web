import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { sendWelcomeEmailIfDue } from '#/server/account/welcome-email'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/storefront/ui'

const RESEND_COOLDOWN_SECONDS = 60

export const Route = createFileRoute('/account/verify')({
  validateSearch: z.object({ email: z.string().email() }),
  component: VerifyPage,
})

function VerifyPage() {
  const { email } = Route.useSearch()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [resendMessage, setResendMessage] = useState<string | null>(null)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setInterval(() => {
      setResendCooldown((s) => Math.max(0, s - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [resendCooldown])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const { error: verifyError } =
      await getSupabaseBrowserClient().auth.verifyOtp({
        email,
        token: code,
        type: 'signup',
      })

    if (verifyError) {
      setError(verifyError.message)
      setSubmitting(false)
      return
    }

    // This is the actual first-login moment — signUp() itself only starts
    // the flow, verifyOtp() is what establishes the real session (see
    // sendWelcomeEmailIfDue's own doc comment). Best-effort: a failure here
    // shouldn't block account creation from completing.
    try {
      await sendWelcomeEmailIfDue()
    } catch {
      // Swallowed deliberately.
    }

    await navigate({ to: '/account' })
  }

  async function handleResend() {
    setResendMessage(null)
    setError(null)

    const { error: resendError } = await getSupabaseBrowserClient().auth.resend(
      { type: 'signup', email },
    )

    if (resendError) {
      setError(resendError.message)
      return
    }

    setResendMessage('A new code has been sent.')
    setResendCooldown(RESEND_COOLDOWN_SECONDS)
  }

  return (
    <div className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        We sent a 6-digit code to <strong>{email}</strong>. Enter it below to
        verify your account.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <label className={labelClassName}>
          Verification code
          <input
            required
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className={`${inputClassName} text-center text-lg tracking-[0.5em]`}
            placeholder="000000"
          />
        </label>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        {resendMessage && (
          <p className="text-sm text-green-700 dark:text-green-400">
            {resendMessage}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting || code.length !== 6}
          className={`${buttonPrimaryClassName} w-full justify-center`}
        >
          {submitting ? 'Verifying…' : 'Verify'}
        </button>
        <button
          type="button"
          disabled={resendCooldown > 0}
          onClick={handleResend}
          className={`${buttonSecondaryClassName} w-full justify-center`}
        >
          {resendCooldown > 0
            ? `Resend code (${resendCooldown}s)`
            : 'Resend code'}
        </button>
      </form>
    </div>
  )
}

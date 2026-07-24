import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { sendWelcomeEmailIfDue } from '#/server/account/welcome-email'

export const Route = createFileRoute('/auth/callback')({
  component: AuthCallbackPage,
})

// Supabase treats a first-time Google sign-in the same as any other login
// (no distinct "signup" event to hook), so this is the only place a
// Google-signup customer's welcome email can fire — idempotent via
// customers.welcome_emailed_at, so calling it from both a state-change event
// and the immediate getSession() check below is a harmless double-check, not
// a double-send.
async function handleSession() {
  try {
    await sendWelcomeEmailIfDue()
  } catch {
    // Swallowed deliberately — must never block getting the user signed in.
  }
}

function AuthCallbackPage() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // @supabase/ssr's browser client auto-detects the OAuth code in this
    // page's URL on init and exchanges it for a session — this just waits
    // for that to land, either via the auth-state event or an immediate
    // getSession() in case it already resolved before this effect ran.
    const supabase = getSupabaseBrowserClient()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        void handleSession().then(() => navigate({ to: '/account' }))
      }
    })

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        void handleSession().then(() => navigate({ to: '/account' }))
      }
    })

    const timeout = setTimeout(() => {
      setError('Sign-in failed. Please try again.')
    }, 8000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [navigate])

  if (error) {
    return (
      <div className="mx-auto max-w-sm px-6 py-16 text-center">
        <h1 className="text-xl font-bold">Sign-in failed</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {error}
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-sm px-6 py-16 text-center text-neutral-500 dark:text-neutral-400">
      Signing you in…
    </div>
  )
}

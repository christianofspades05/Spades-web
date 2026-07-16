import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'

export const Route = createFileRoute('/auth/callback')({
  component: AuthCallbackPage,
})

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
      if (session) void navigate({ to: '/account' })
    })

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) void navigate({ to: '/account' })
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

import { useState } from 'react'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { buttonSecondaryClassName } from '#/components/storefront/ui'

export function GoogleButton({
  label = 'Continue with Google',
}: {
  label?: string
}) {
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setError(null)
    const { error: oauthError } =
      await getSupabaseBrowserClient().auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      })
    if (oauthError) setError(oauthError.message)
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        className={`${buttonSecondaryClassName} w-full justify-center gap-2.5`}
      >
        <img src="/google-logo.svg" alt="" className="h-4 w-4" />
        {label}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

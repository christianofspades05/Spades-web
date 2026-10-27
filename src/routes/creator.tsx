import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { getCreatorSession } from '#/server/creator/auth'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { buttonSecondaryClassName } from '#/components/admin/ui'

export const Route = createFileRoute('/creator')({
  beforeLoad: async () => {
    const creator = await getCreatorSession()
    if (!creator) throw redirect({ to: '/creator/login' })
    return { creator }
  },
  component: CreatorLayout,
})

function CreatorLayout() {
  const { creator } = Route.useRouteContext()
  const navigate = useNavigate()

  async function handleSignOut() {
    await getSupabaseBrowserClient().auth.signOut()
    await navigate({ to: '/creator/login' })
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="flex items-center justify-between border-b bg-white px-4 py-3 sm:px-8">
        <div>
          <p className="text-sm font-black tracking-tight">SPADES</p>
          <p className="text-xs text-neutral-500">{creator.name}</p>
        </div>
        <button onClick={handleSignOut} className={buttonSecondaryClassName}>
          Sign out
        </button>
      </header>
      <main className="px-4 py-6 sm:px-8 sm:py-10">
        <Outlet />
      </main>
    </div>
  )
}

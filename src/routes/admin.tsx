import { useState } from 'react'
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { Menu, X } from 'lucide-react'
import { getStaffSession } from '#/server/admin/auth'
import { AdminNav } from '#/components/admin/AdminNav'

export const Route = createFileRoute('/admin')({
  beforeLoad: async () => {
    const staff = await getStaffSession()
    if (!staff) throw redirect({ to: '/admin/login' })
    return { staff }
  },
  component: AdminLayout,
})

function AdminLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="flex min-h-screen">
      <AdminNav className="hidden w-60 shrink-0 border-r lg:flex" />

      <div
        className={`fixed inset-0 z-40 lg:hidden ${mobileNavOpen ? '' : 'pointer-events-none'}`}
      >
        <div
          onClick={() => setMobileNavOpen(false)}
          className={`absolute inset-0 bg-black/40 transition-opacity ${
            mobileNavOpen ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <AdminNav
          onNavigate={() => setMobileNavOpen(false)}
          className={`absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r shadow-xl transition-transform duration-200 ${
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        />
      </div>

      <div className="flex min-h-screen flex-1 flex-col bg-neutral-50">
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100"
          >
            {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <img src="/logo-black.png" alt="Spades" className="h-4 w-auto" />
        </div>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

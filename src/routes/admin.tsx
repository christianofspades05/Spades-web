import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
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
  return (
    <div className="flex min-h-screen">
      <AdminNav />
      <main className="min-h-screen flex-1 bg-neutral-50">
        <Outlet />
      </main>
    </div>
  )
}

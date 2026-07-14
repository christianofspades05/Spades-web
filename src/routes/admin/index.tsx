import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/')({ component: AdminPage })

function AdminPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-bold">Admin</h1>
      <p className="mt-4 text-neutral-600">
        The staff dashboard (products, orders, inventory, discounts, staff
        accounts) is intentionally not built yet — see{' '}
        <code>src/server/admin/README.md</code> for the planned design.
      </p>
    </div>
  )
}

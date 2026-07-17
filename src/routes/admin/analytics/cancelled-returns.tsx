import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '#/components/admin/PageHeader'

export const Route = createFileRoute('/admin/analytics/cancelled-returns')({
  component: CancelledReturnsPage,
})

function CancelledReturnsPage() {
  return (
    <div className="w-full px-8 py-10">
      <PageHeader
        title="Cancelled and Returns"
        subtitle="Cancellation and return trends by reason and channel."
      />
      <p className="mt-6 text-sm text-neutral-500">Coming soon.</p>
    </div>
  )
}

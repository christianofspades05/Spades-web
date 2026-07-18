import { createFileRoute, useRouter } from '@tanstack/react-router'
import { listChannelConnections } from '#/server/admin/channels'
import { ConnectionCard } from '#/components/admin/channel-sync'
import { PageHeader } from '#/components/admin/PageHeader'

export const Route = createFileRoute('/admin/channels/')({
  loader: () => listChannelConnections(),
  component: ChannelsPage,
})

function ChannelsPage() {
  const connections = Route.useLoaderData()
  const router = useRouter()

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Channels"
        subtitle="Connect Spades to marketplace sales channels — inventory syncs out, orders sync in."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {connections.map((info) => (
          <ConnectionCard
            key={info.marketplace}
            info={info}
            onChanged={() => router.invalidate()}
          />
        ))}
      </div>
    </div>
  )
}

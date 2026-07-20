import { useState } from 'react'
import { createFileRoute, Link, notFound, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import {
  listChannelConnections,
  listProductSyncStatus,
  listRecentSyncLogs,
} from '#/server/admin/channels'
import { listAllCollections } from '#/server/admin/collections'
import { IMPLEMENTED_MARKETPLACES } from '#/server/integrations/marketplaces/implemented'
import type { SyncableMarketplace } from '#/server/integrations/marketplaces/types'
import {
  CONNECTION_FILTER_LABELS,
  ConnectionCard,
  MARKETPLACE_LABELS,
  ProductSyncSection,
  RecentActivity,
  SORT_LABELS,
} from '#/components/admin/channel-sync'
import type {
  ConnectionFilter,
  ProductSort,
} from '#/components/admin/channel-sync'
import { PageHeader } from '#/components/admin/PageHeader'
import { inputClassName } from '#/components/admin/ui'

const SYNCABLE_MARKETPLACES = ['tiktok_shop', 'shopee', 'lazada'] as const

function isSyncableMarketplace(value: string): value is SyncableMarketplace {
  return (SYNCABLE_MARKETPLACES as readonly string[]).includes(value)
}

export const Route = createFileRoute('/admin/channels/$marketplace')({
  validateSearch: z.object({
    collectionId: z.string().uuid().optional(),
  }),
  loaderDeps: ({ search }) => ({ collectionId: search.collectionId }),
  loader: async ({ params, deps }) => {
    if (
      !isSyncableMarketplace(params.marketplace) ||
      !IMPLEMENTED_MARKETPLACES.includes(params.marketplace)
    ) {
      throw notFound()
    }
    const marketplace = params.marketplace

    const [connections, products, logs, collections] = await Promise.all([
      listChannelConnections(),
      listProductSyncStatus({
        data: { marketplace, collectionId: deps.collectionId },
      }),
      listRecentSyncLogs({ data: { marketplace } }),
      listAllCollections(),
    ])

    return { marketplace, connections, products, logs, collections }
  },
  component: MarketplaceChannelPage,
})

function MarketplaceChannelPage() {
  const { marketplace, connections, products, logs, collections } =
    Route.useLoaderData()
  const { collectionId } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()

  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<ProductSort>('name_asc')
  const [connectionFilter, setConnectionFilter] =
    useState<ConnectionFilter>('all')

  const info = connections.find((c) => c.marketplace === marketplace)
  const connection = info?.connection

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <Link
        to="/admin/channels"
        className="text-xs font-medium text-neutral-500 hover:text-neutral-700"
      >
        ← Channels
      </Link>

      <div className="mt-2">
        <PageHeader
          title={MARKETPLACE_LABELS[marketplace]}
          subtitle="Connection status, product sync, and recent activity for this channel."
        />
      </div>

      {info && (
        <div className="max-w-sm">
          <ConnectionCard info={info} onChanged={() => router.invalidate()} />
        </div>
      )}

      <div className="mt-10 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by product name or SKU…"
          className={`${inputClassName} w-64`}
        />
        <select
          value={collectionId ?? ''}
          onChange={(e) =>
            navigate({
              search: (prev) => ({
                ...prev,
                collectionId: e.target.value || undefined,
              }),
            })
          }
          className={inputClassName}
        >
          <option value="">All collections</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as ProductSort)}
          className={inputClassName}
        >
          {(Object.keys(SORT_LABELS) as ProductSort[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
        <select
          value={connectionFilter}
          onChange={(e) =>
            setConnectionFilter(e.target.value as ConnectionFilter)
          }
          className={inputClassName}
        >
          {(Object.keys(CONNECTION_FILTER_LABELS) as ConnectionFilter[]).map(
            (key) => (
              <option key={key} value={key}>
                {CONNECTION_FILTER_LABELS[key]}
              </option>
            ),
          )}
        </select>
      </div>

      <div className="mt-4">
        <ProductSyncSection
          marketplace={marketplace}
          products={products}
          search={search}
          sortBy={sortBy}
          connectionFilter={connectionFilter}
          connected={connection?.status === 'active'}
          inventorySyncEnabled={connection?.inventory_sync_enabled ?? false}
          onChanged={() => router.invalidate()}
        />
      </div>

      <div className="mt-10">
        <RecentActivity logs={logs} />
      </div>
    </div>
  )
}

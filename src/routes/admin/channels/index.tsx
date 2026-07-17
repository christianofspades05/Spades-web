import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  bulkSyncChannel,
  disconnectChannel,
  linkProductToChannel,
  listChannelConnections,
  listProductSyncStatus,
  listRecentSyncLogs,
  pullOrdersNow,
  syncProductNow,
} from '#/server/admin/channels'
import type {
  ChannelConnectionInfo,
  ProductSyncRow,
} from '#/server/admin/channels'
import { getErrorMessage } from '#/lib/utils/errors'
import { PageHeader } from '#/components/admin/PageHeader'
import { Card } from '#/components/admin/Card'
import { Badge } from '#/components/admin/Badge'
import type { BadgeTone } from '#/components/admin/Badge'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'
import type { MarketplaceName } from '#/types/entities'

const MARKETPLACE_LABELS: Record<MarketplaceName, string> = {
  tiktok_shop: 'TikTok Shop',
  shopee: 'Shopee',
  lazada: 'Lazada',
  other: 'Other',
}

const CONNECTION_TONE: Record<string, BadgeTone> = {
  active: 'success',
  expired: 'warning',
  revoked: 'neutral',
  error: 'critical',
}

const CONNECTION_LABEL: Record<string, string> = {
  active: 'Connected',
  expired: 'Connected (needs refresh)',
  revoked: 'Not connected',
  error: 'Error',
}

export const Route = createFileRoute('/admin/channels/')({
  loader: async () => {
    const [connections, products, logs] = await Promise.all([
      listChannelConnections(),
      listProductSyncStatus({ data: { marketplace: 'tiktok_shop' } }),
      listRecentSyncLogs({ data: { marketplace: 'tiktok_shop' } }),
    ])
    return { connections, products, logs }
  },
  component: ChannelsPage,
})

function ChannelsPage() {
  const { connections, products, logs } = Route.useLoaderData()
  const router = useRouter()

  return (
    <div className="w-full px-8 py-10">
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

      <div className="mt-10">
        <ProductSyncSection
          products={products}
          connected={
            connections.find((c) => c.marketplace === 'tiktok_shop')?.connection
              ?.status === 'active'
          }
          onChanged={() => router.invalidate()}
        />
      </div>

      <div className="mt-10">
        <RecentActivity logs={logs} />
      </div>
    </div>
  )
}

function ConnectionCard({
  info,
  onChanged,
}: {
  info: ChannelConnectionInfo
  onChanged: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const status = info.connection?.status ?? 'revoked'

  async function handleDisconnect() {
    setSubmitting(true)
    setError(null)
    try {
      await disconnectChannel({
        data: { marketplace: info.marketplace as 'tiktok_shop' },
      })
      onChanged()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900">
          {MARKETPLACE_LABELS[info.marketplace]}
        </h2>
        {info.implemented ? (
          <Badge tone={CONNECTION_TONE[status] ?? 'neutral'}>
            {CONNECTION_LABEL[status] ?? 'Not connected'}
          </Badge>
        ) : (
          <Badge tone="neutral">Coming soon</Badge>
        )}
      </div>

      {info.connection?.shop_name && (
        <p className="mt-2 text-xs text-neutral-500">
          {info.connection.shop_name}
        </p>
      )}

      <div className="mt-4">
        {!info.implemented ? (
          <button
            type="button"
            disabled
            className={`${buttonSecondaryClassName} w-full justify-center`}
          >
            Not available yet
          </button>
        ) : status === 'active' || status === 'expired' ? (
          <button
            type="button"
            disabled={submitting}
            onClick={handleDisconnect}
            className={`${buttonSecondaryClassName} w-full justify-center`}
          >
            {submitting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : (
          <a
            href="/api/oauth/tiktok/connect"
            className={`${buttonPrimaryClassName} w-full justify-center`}
          >
            Connect
          </a>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </Card>
  )
}

function ProductSyncSection({
  products,
  connected,
  onChanged,
}: {
  products: ProductSyncRow[]
  connected: boolean
  onChanged: () => void
}) {
  const [bulkSyncing, setBulkSyncing] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleBulkSync() {
    setBulkSyncing(true)
    setError(null)
    try {
      await bulkSyncChannel({ data: { marketplace: 'tiktok_shop' } })
      onChanged()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBulkSyncing(false)
    }
  }

  async function handlePullOrders() {
    setPulling(true)
    setError(null)
    try {
      await pullOrdersNow({
        data: { marketplace: 'tiktok_shop', sinceHours: 24 },
      })
      onChanged()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setPulling(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900">
          TikTok Shop — product sync
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!connected || pulling}
            onClick={handlePullOrders}
            className={buttonSecondaryClassName}
          >
            {pulling ? 'Pulling…' : 'Pull orders now'}
          </button>
          <button
            type="button"
            disabled={!connected || bulkSyncing}
            onClick={handleBulkSync}
            className={buttonPrimaryClassName}
          >
            {bulkSyncing ? 'Syncing…' : 'Sync all products'}
          </button>
        </div>
      </div>
      {!connected && (
        <p className="mt-2 text-xs text-neutral-500">
          Connect TikTok Shop above before syncing products or pulling orders.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className={`${tableWrapperClassName} mt-4`}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={tableHeadClassName}>Product</th>
              <th className={tableHeadClassName}>Our SKU</th>
              <th className={tableHeadClassName}>Stock</th>
              <th className={tableHeadClassName}>TikTok link</th>
              <th className={tableHeadClassName}>Status</th>
              <th className={tableHeadClassName} />
            </tr>
          </thead>
          <tbody>
            {products.map((row) => (
              <ProductSyncRowView
                key={row.variantId}
                row={row}
                connected={connected}
                onChanged={onChanged}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const SYNC_STATUS_TONE: Record<string, BadgeTone> = {
  synced: 'success',
  pending: 'warning',
  error: 'critical',
}

function ProductSyncRowView({
  row,
  connected,
  onChanged,
}: {
  row: ProductSyncRow
  connected: boolean
  onChanged: () => void
}) {
  const [linking, setLinking] = useState(false)
  const [externalId, setExternalId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const variantLabel = [row.size, row.color, row.style]
    .filter(Boolean)
    .join(' / ')

  async function handleLink(event: React.FormEvent) {
    event.preventDefault()
    if (!externalId.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await linkProductToChannel({
        data: {
          marketplace: 'tiktok_shop',
          variantId: row.variantId,
          externalVariantId: externalId.trim(),
        },
      })
      setLinking(false)
      setExternalId('')
      onChanged()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSyncNow() {
    setSubmitting(true)
    setError(null)
    try {
      await syncProductNow({ data: { variantId: row.variantId } })
      onChanged()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <tr className={tableRowClassName}>
      <td className={tableCellClassName}>
        <div className="flex items-center gap-2">
          {row.productImage ? (
            <img
              src={row.productImage}
              alt=""
              className="size-9 shrink-0 rounded object-cover"
            />
          ) : (
            <div className="size-9 shrink-0 rounded bg-neutral-100" />
          )}
          <div>
            <p className="font-medium text-neutral-900">{row.productName}</p>
            {variantLabel && (
              <p className="text-xs text-neutral-500">{variantLabel}</p>
            )}
          </div>
        </div>
      </td>
      <td className={tableCellClassName}>{row.sku}</td>
      <td className={tableCellClassName}>{row.quantityAvailable}</td>
      <td className={tableCellClassName}>
        {row.mapping ? (
          <span className="text-xs text-neutral-600">
            {row.mapping.externalSku ?? row.mapping.externalVariantId}
          </span>
        ) : linking ? (
          <form onSubmit={handleLink} className="flex items-center gap-1.5">
            <input
              autoFocus
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              placeholder="TikTok SKU id"
              className={`${inputClassName} w-32 py-1 text-xs`}
            />
            <button
              type="submit"
              disabled={submitting}
              className="text-xs font-medium text-neutral-900 underline"
            >
              Save
            </button>
          </form>
        ) : (
          <button
            type="button"
            disabled={!connected}
            onClick={() => setLinking(true)}
            className="text-xs font-medium text-neutral-600 underline disabled:opacity-50"
          >
            + Link to TikTok
          </button>
        )}
      </td>
      <td className={tableCellClassName}>
        {row.mapping ? (
          <Badge tone={SYNC_STATUS_TONE[row.mapping.syncStatus] ?? 'neutral'}>
            {row.mapping.syncStatus === 'synced'
              ? 'Synced'
              : row.mapping.syncStatus === 'pending'
                ? 'Pending'
                : 'Error'}
          </Badge>
        ) : (
          <Badge tone="neutral">Not linked</Badge>
        )}
      </td>
      <td className={`${tableCellClassName} text-right`}>
        {row.mapping && (
          <button
            type="button"
            disabled={submitting}
            onClick={handleSyncNow}
            className="text-xs font-medium text-neutral-900 underline disabled:opacity-50"
          >
            {submitting ? 'Syncing…' : 'Sync now'}
          </button>
        )}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </td>
    </tr>
  )
}

function RecentActivity({
  logs,
}: {
  logs: {
    id: string
    operation: string
    status: string
    errorMessage: string | null
    createdAt: string
  }[]
}) {
  if (logs.length === 0) {
    return null
  }
  return (
    <div>
      <h2 className="text-sm font-semibold text-neutral-900">
        Recent sync activity
      </h2>
      <ul className="mt-3 flex flex-col divide-y divide-neutral-100 rounded-lg border border-neutral-200">
        {logs.map((log) => (
          <li
            key={log.id}
            className="flex items-center justify-between px-4 py-2.5 text-sm"
          >
            <div>
              <p className="font-medium text-neutral-900">
                {log.operation.replace(/_/g, ' ')}
              </p>
              {log.errorMessage && (
                <p className="mt-0.5 text-xs text-red-600">
                  {log.errorMessage}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Badge tone={log.status === 'success' ? 'success' : 'critical'}>
                {log.status === 'success' ? 'Success' : 'Failed'}
              </Badge>
              <span className="text-xs text-neutral-500">
                {new Date(log.createdAt).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

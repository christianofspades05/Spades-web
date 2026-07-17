import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import {
  autoConnectBySku,
  autoConnectProducts,
  bulkSyncChannel,
  connectExistingProduct,
  disconnectChannel,
  getMarketplaceCategoryAttributes,
  listChannelConnections,
  listMarketplaceCategories,
  listProductSyncStatus,
  listRecentSyncLogs,
  pullOrdersNow,
  pushProductToMarketplace,
  setInventorySyncEnabled,
  syncProductNow,
} from '#/server/admin/channels'
import type {
  ChannelConnectionInfo,
  ProductSyncRow,
} from '#/server/admin/channels'
import type {
  AutoConnectByTitleResult,
  AutoConnectBySkuResult,
} from '#/server/integrations/marketplaces/sync-engine'
import { listAllCollections } from '#/server/admin/collections'
import type {
  MarketplaceCategory,
  MarketplaceCategoryAttribute,
} from '#/server/integrations/marketplaces/types'
import { useDebouncedValue } from '#/lib/hooks/useDebouncedValue'
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
  validateSearch: z.object({
    collectionId: z.string().uuid().optional(),
  }),
  loaderDeps: ({ search }) => ({ collectionId: search.collectionId }),
  loader: async ({ deps }) => {
    const [connections, products, logs, collections] = await Promise.all([
      listChannelConnections(),
      listProductSyncStatus({
        data: { marketplace: 'tiktok_shop', collectionId: deps.collectionId },
      }),
      listRecentSyncLogs({ data: { marketplace: 'tiktok_shop' } }),
      listAllCollections(),
    ])
    return { connections, products, logs, collections }
  },
  component: ChannelsPage,
})

type ProductSort = 'name_asc' | 'name_desc' | 'created_desc'

const SORT_LABELS: Record<ProductSort, string> = {
  name_asc: 'Name (A–Z)',
  name_desc: 'Name (Z–A)',
  created_desc: 'Newest first',
}

type ConnectionFilter = 'all' | 'connected' | 'not_connected'

const CONNECTION_FILTER_LABELS: Record<ConnectionFilter, string> = {
  all: 'All statuses',
  connected: 'Connected',
  not_connected: 'Not connected',
}

/**
 * Best-effort browser notification — some browsers/contexts (e.g. Chrome on
 * Android) throw "Illegal constructor" from `new Notification(...)` even
 * when permission is granted, since they require the Service Worker
 * notification API instead. Never let that surface as if the actual
 * operation had failed.
 */
function notifySafely(title: string, body: string): void {
  try {
    if (typeof Notification === 'undefined') return
    if (Notification.permission !== 'granted') return
    new Notification(title, { body })
  } catch {
    // Ignored — the in-page result panel already shows the outcome.
  }
}

function ChannelsPage() {
  const { connections, products, logs, collections } = Route.useLoaderData()
  const { collectionId } = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()

  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<ProductSort>('name_asc')
  const [connectionFilter, setConnectionFilter] =
    useState<ConnectionFilter>('all')

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Channels"
        subtitle="Connect Spades to marketplace sales channels — inventory syncs out, orders sync in."
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
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

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
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
          search={search}
          sortBy={sortBy}
          connectionFilter={connectionFilter}
          connected={
            connections.find((c) => c.marketplace === 'tiktok_shop')?.connection
              ?.status === 'active'
          }
          inventorySyncEnabled={
            connections.find((c) => c.marketplace === 'tiktok_shop')?.connection
              ?.inventory_sync_enabled ?? false
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
  const [togglingSync, setTogglingSync] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const status = info.connection?.status ?? 'revoked'
  const inventorySyncEnabled = info.connection?.inventory_sync_enabled ?? false

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

  async function handleToggleInventorySync() {
    setTogglingSync(true)
    setError(null)
    try {
      await setInventorySyncEnabled({
        data: {
          marketplace: info.marketplace as 'tiktok_shop',
          enabled: !inventorySyncEnabled,
        },
      })
      onChanged()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setTogglingSync(false)
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
      {status === 'active' && !info.connection?.shop_cipher && (
        <p className="mt-2 text-xs text-amber-600">
          Connected, but missing a required permission — product/order sync will
          fail until that's resolved with TikTok. Disconnect and reconnect after
          fixing app permissions.
        </p>
      )}

      {(status === 'active' || status === 'expired') && (
        <label className="mt-3 flex items-start gap-2 text-xs text-neutral-600">
          <input
            type="checkbox"
            checked={inventorySyncEnabled}
            disabled={togglingSync}
            onChange={handleToggleInventorySync}
            className="mt-0.5"
          />
          <span>
            Automatically sync inventory to this channel
            {!inventorySyncEnabled && (
              <span className="block text-neutral-400">
                Off by default — turn on once you're ready, e.g. after turning
                off any other tool (like Shopify) that already syncs stock here.
                Turning this on immediately pushes stock for every connected
                product.
              </span>
            )}
          </span>
        </label>
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

interface GroupedProduct {
  productId: string
  productName: string
  productImage: string | null
  productCreatedAt: string
  variants: ProductSyncRow[]
}

function groupByProduct(rows: ProductSyncRow[]): GroupedProduct[] {
  const byProduct = new Map<string, GroupedProduct>()
  for (const row of rows) {
    const existing = byProduct.get(row.productId)
    if (existing) {
      existing.variants.push(row)
    } else {
      byProduct.set(row.productId, {
        productId: row.productId,
        productName: row.productName,
        productImage: row.productImage,
        productCreatedAt: row.productCreatedAt,
        variants: [row],
      })
    }
  }
  return Array.from(byProduct.values())
}

function ProductSyncSection({
  products,
  search,
  sortBy,
  connectionFilter,
  connected,
  inventorySyncEnabled,
  onChanged,
}: {
  products: ProductSyncRow[]
  search: string
  sortBy: ProductSort
  connectionFilter: ConnectionFilter
  connected: boolean
  inventorySyncEnabled: boolean
  onChanged: () => void
}) {
  const [bulkSyncing, setBulkSyncing] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [autoConnecting, setAutoConnecting] = useState<'title' | 'sku' | null>(
    null,
  )
  const [autoConnectResult, setAutoConnectResult] = useState<{
    mode: 'title' | 'sku'
    result: AutoConnectByTitleResult | AutoConnectBySkuResult
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openProductId, setOpenProductId] = useState<string | null>(null)
  const [connectingProductId, setConnectingProductId] = useState<string | null>(
    null,
  )

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase()
    const grouped = groupByProduct(products)
    const searched = query
      ? grouped.filter(
          (p) =>
            p.productName.toLowerCase().includes(query) ||
            p.variants.some((v) => v.sku.toLowerCase().includes(query)),
        )
      : grouped
    const filtered =
      connectionFilter === 'all'
        ? searched
        : searched.filter((p) => {
            const isConnected = p.variants.some((v) => v.mapping)
            return connectionFilter === 'connected' ? isConnected : !isConnected
          })

    return [...filtered].sort((a, b) => {
      if (sortBy === 'name_asc')
        return a.productName.localeCompare(b.productName)
      if (sortBy === 'name_desc')
        return b.productName.localeCompare(a.productName)
      return (
        new Date(b.productCreatedAt).getTime() -
        new Date(a.productCreatedAt).getTime()
      )
    })
  }, [products, search, sortBy, connectionFilter])

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

  async function handleAutoConnect(mode: 'title' | 'sku') {
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'default'
    ) {
      void Notification.requestPermission()
    }

    setAutoConnecting(mode)
    setError(null)
    setAutoConnectResult(null)
    const modeLabel = mode === 'title' ? 'title' : 'SKU'
    try {
      const result =
        mode === 'title'
          ? await autoConnectProducts({ data: { marketplace: 'tiktok_shop' } })
          : await autoConnectBySku({ data: { marketplace: 'tiktok_shop' } })
      setAutoConnectResult({ mode, result })
      onChanged()
      notifySafely(
        `Auto-connect by ${modeLabel} finished`,
        `Connected ${result.connected.length} product${result.connected.length === 1 ? '' : 's'}.${result.skipped.length > 0 ? ` ${result.skipped.length} need manual review.` : ''}`,
      )
    } catch (err) {
      const message = getErrorMessage(err)
      setError(message)
      notifySafely(`Auto-connect by ${modeLabel} failed`, message)
    } finally {
      setAutoConnecting(null)
    }
  }

  const openProduct = visibleProducts.find((p) => p.productId === openProductId)
  const connectingProduct = visibleProducts.find(
    (p) => p.productId === connectingProductId,
  )

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
            disabled={!connected || autoConnecting !== null}
            onClick={() => handleAutoConnect('title')}
            className={buttonSecondaryClassName}
            title="Automatically links every unlinked product to a TikTok listing with the exact same title. Anything that doesn't match cleanly is left for you to connect manually. Allow browser notifications to get pinged when this finishes."
          >
            {autoConnecting === 'title' ? 'Matching…' : 'Auto-connect by title'}
          </button>
          <button
            type="button"
            disabled={!connected || autoConnecting !== null}
            onClick={() => handleAutoConnect('sku')}
            className={buttonSecondaryClassName}
            title="Automatically links every unlinked product to a TikTok listing whose full set of variant SKUs matches exactly — useful when titles were never kept in sync. Allow browser notifications to get pinged when this finishes."
          >
            {autoConnecting === 'sku' ? 'Matching…' : 'Auto-connect by SKU'}
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

      {autoConnectResult && (
        <Card className="mt-4 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-neutral-900">
              Connected {autoConnectResult.result.connected.length} product
              {autoConnectResult.result.connected.length === 1 ? '' : 's'} by
              matching {autoConnectResult.mode === 'title' ? 'title' : 'SKU'}.
              {autoConnectResult.result.skipped.length > 0 &&
                ` ${autoConnectResult.result.skipped.length} need${
                  autoConnectResult.result.skipped.length === 1 ? 's' : ''
                } manual review.`}
            </p>
            <button
              type="button"
              onClick={() => setAutoConnectResult(null)}
              className="text-xs font-medium text-neutral-500 underline"
            >
              Dismiss
            </button>
          </div>
          {autoConnectResult.result.skipped.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5 text-xs text-neutral-600">
              {autoConnectResult.result.skipped.map((s) => (
                <li key={s.productId}>
                  <span className="font-medium text-neutral-900">
                    {s.productName}
                  </span>{' '}
                  — {s.reason}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className={`${tableWrapperClassName} mt-4`}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={tableHeadClassName}>Product</th>
              <th className={tableHeadClassName}>Variants</th>
              <th className={tableHeadClassName}>Stock</th>
              <th className={tableHeadClassName}>TikTok status</th>
              <th className={tableHeadClassName} />
            </tr>
          </thead>
          <tbody>
            {visibleProducts.map((product) => (
              <ProductGroupRow
                key={product.productId}
                product={product}
                connected={connected}
                inventorySyncEnabled={inventorySyncEnabled}
                onChanged={onChanged}
                onPush={() => setOpenProductId(product.productId)}
                onConnect={() => setConnectingProductId(product.productId)}
              />
            ))}
          </tbody>
        </table>
        {visibleProducts.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-neutral-500">
            No products match this search/filter.
          </p>
        )}
      </div>

      {openProduct && (
        <PushToTikTokModal
          productId={openProduct.productId}
          productName={openProduct.productName}
          onClose={() => setOpenProductId(null)}
          onPushed={() => {
            setOpenProductId(null)
            onChanged()
          }}
        />
      )}

      {connectingProduct && (
        <ConnectExistingProductModal
          productId={connectingProduct.productId}
          productName={connectingProduct.productName}
          onClose={() => setConnectingProductId(null)}
          onConnected={() => {
            setConnectingProductId(null)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

function ProductGroupRow({
  product,
  connected,
  inventorySyncEnabled,
  onChanged,
  onPush,
  onConnect,
}: {
  product: GroupedProduct
  connected: boolean
  inventorySyncEnabled: boolean
  onChanged: () => void
  onPush: () => void
  onConnect: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mappedVariants = product.variants.filter((v) => v.mapping)
  const totalStock = product.variants.reduce(
    (sum, v) => sum + v.quantityAvailable,
    0,
  )

  async function handleSyncNow() {
    setSubmitting(true)
    setError(null)
    try {
      for (const v of mappedVariants) {
        await syncProductNow({ data: { variantId: v.variantId } })
      }
      onChanged()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  let statusTone: BadgeTone = 'neutral'
  let statusLabel = 'Not linked'
  if (mappedVariants.length > 0) {
    if (mappedVariants.length < product.variants.length) {
      statusTone = 'warning'
      statusLabel = `Partially linked (${mappedVariants.length}/${product.variants.length})`
    } else if (mappedVariants.some((v) => v.mapping?.syncStatus === 'error')) {
      statusTone = 'critical'
      statusLabel = 'Error'
    } else if (
      mappedVariants.some((v) => v.mapping?.syncStatus === 'pending')
    ) {
      statusTone = 'warning'
      statusLabel = 'Pending'
    } else {
      statusTone = 'success'
      statusLabel = 'Synced'
    }
  }

  return (
    <tr className={tableRowClassName}>
      <td className={tableCellClassName}>
        <div className="flex items-center gap-2">
          {product.productImage ? (
            <img
              src={product.productImage}
              alt=""
              className="size-9 shrink-0 rounded object-cover"
            />
          ) : (
            <div className="size-9 shrink-0 rounded bg-neutral-100" />
          )}
          <p className="font-medium text-neutral-900">{product.productName}</p>
        </div>
      </td>
      <td className={tableCellClassName}>
        <ul className="flex flex-col gap-0.5 text-xs text-neutral-600">
          {product.variants.map((v) => {
            const variantLabel = [v.size, v.color, v.style]
              .filter(Boolean)
              .join(' / ')
            return (
              <li key={v.variantId}>
                {v.sku}
                {variantLabel && ` (${variantLabel})`}
                {v.mapping && (
                  <span className="text-neutral-400">
                    {' '}
                    — {v.mapping.externalSku ?? v.mapping.externalVariantId}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </td>
      <td className={tableCellClassName}>{totalStock}</td>
      <td className={tableCellClassName}>
        <Badge tone={statusTone}>{statusLabel}</Badge>
      </td>
      <td className={`${tableCellClassName} text-right`}>
        {mappedVariants.length > 0 ? (
          <div className="flex justify-end gap-3">
            <button
              type="button"
              disabled={submitting}
              onClick={handleSyncNow}
              title={
                inventorySyncEnabled
                  ? undefined
                  : 'Automatic sync is off for this channel — this pushes this product once, right now, without turning that on.'
              }
              className="text-xs font-medium text-neutral-900 underline disabled:cursor-not-allowed disabled:text-neutral-400 disabled:no-underline"
            >
              {submitting ? 'Syncing…' : 'Sync now'}
            </button>
            <button
              type="button"
              disabled={!connected}
              onClick={onConnect}
              title="Re-link this product to a TikTok listing by pasting its product id — use this to repair a broken or mismatched connection."
              className="text-xs font-medium text-neutral-600 underline disabled:cursor-not-allowed disabled:text-neutral-400 disabled:no-underline"
            >
              Reconnect
            </button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={!connected}
              onClick={onConnect}
              className={`${buttonSecondaryClassName} disabled:opacity-50`}
            >
              Connect existing
            </button>
            <button
              type="button"
              disabled={!connected}
              onClick={onPush}
              className={`${buttonPrimaryClassName} disabled:opacity-50`}
            >
              Push to TikTok
            </button>
          </div>
        )}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </td>
    </tr>
  )
}

function ConnectExistingProductModal({
  productId,
  productName,
  onClose,
  onConnected,
}: {
  productId: string
  productName: string
  onClose: () => void
  onConnected: () => void
}) {
  const [externalProductId, setExternalProductId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!externalProductId.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await connectExistingProduct({
        data: {
          marketplace: 'tiktok_shop',
          productId,
          externalProductId: externalProductId.trim(),
        },
      })
      onConnected()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <Card className="w-full max-w-lg p-6">
        <h2 className="text-sm font-semibold text-neutral-900">
          Connect "{productName}" to an existing TikTok listing
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          The TikTok product title and every variant (size/color/style) must
          match exactly, including letter case — otherwise this is refused
          rather than partially linked.
        </p>

        <form onSubmit={handleSubmit} className="mt-4">
          <label className="text-xs font-medium text-neutral-600">
            TikTok product ID
          </label>
          <input
            autoFocus
            value={externalProductId}
            onChange={(e) => setExternalProductId(e.target.value)}
            placeholder="e.g. 1729xxxxxxxxxxxxxxx"
            className={`${inputClassName} mt-1 w-full`}
          />

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className={buttonSecondaryClassName}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !externalProductId.trim()}
              className={`${buttonPrimaryClassName} disabled:opacity-50`}
            >
              {submitting ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  )
}

function PushToTikTokModal({
  productId,
  productName,
  onClose,
  onPushed,
}: {
  productId: string
  productName: string
  onClose: () => void
  onPushed: () => void
}) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 300)
  const [categories, setCategories] = useState<MarketplaceCategory[]>([])
  const [searching, setSearching] = useState(false)
  const [category, setCategory] = useState<MarketplaceCategory | null>(null)
  const [attributes, setAttributes] = useState<MarketplaceCategoryAttribute[]>(
    [],
  )
  const [attributeAnswers, setAttributeAnswers] = useState<
    Record<string, string | undefined>
  >({})
  const [loadingAttributes, setLoadingAttributes] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (category || !debouncedQuery.trim()) {
      setCategories([])
      return
    }
    let cancelled = false
    setSearching(true)
    listMarketplaceCategories({
      data: { marketplace: 'tiktok_shop', query: debouncedQuery.trim() },
    })
      .then((result) => {
        if (!cancelled) setCategories(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setSearching(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedQuery, category])

  async function handleSelectCategory(selected: MarketplaceCategory) {
    setCategory(selected)
    setCategories([])
    setError(null)
    setLoadingAttributes(true)
    try {
      const result = await getMarketplaceCategoryAttributes({
        data: { marketplace: 'tiktok_shop', categoryId: selected.id },
      })
      setAttributes(result)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoadingAttributes(false)
    }
  }

  async function handleSubmit() {
    if (!category) return
    const missing = attributes.filter(
      (a) => a.required && !attributeAnswers[a.id]?.trim(),
    )
    if (missing.length > 0) {
      setError(`Please fill in: ${missing.map((a) => a.name).join(', ')}`)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await pushProductToMarketplace({
        data: {
          marketplace: 'tiktok_shop',
          productId,
          categoryId: category.id,
          attributeValues: attributes.map((a) => {
            const answer = attributeAnswers[a.id] ?? ''
            return a.values
              ? { attributeId: a.id, valueId: answer }
              : { attributeId: a.id, value: answer }
          }),
        },
      })
      onPushed()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <Card className="w-full max-w-lg p-6">
        <h2 className="text-sm font-semibold text-neutral-900">
          Push "{productName}" to TikTok Shop
        </h2>

        {!category ? (
          <div className="mt-4">
            <label className="text-xs font-medium text-neutral-600">
              TikTok category
            </label>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search categories, e.g. Women's Dresses"
              className={`${inputClassName} mt-1 w-full`}
            />
            {searching && (
              <p className="mt-2 text-xs text-neutral-500">Searching…</p>
            )}
            {categories.length > 0 && (
              <ul className="mt-2 max-h-48 divide-y divide-neutral-100 overflow-y-auto rounded-lg border border-neutral-200">
                {categories.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectCategory(c)}
                      className="w-full px-3 py-2 text-left text-sm text-neutral-900 hover:bg-neutral-50"
                    >
                      {c.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="mt-4">
            <div className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-sm">
              <span className="text-neutral-900">{category.name}</span>
              <button
                type="button"
                onClick={() => {
                  setCategory(null)
                  setAttributes([])
                  setAttributeAnswers({})
                }}
                className="text-xs font-medium text-neutral-600 underline"
              >
                Change
              </button>
            </div>

            {loadingAttributes ? (
              <p className="mt-3 text-xs text-neutral-500">
                Loading required details…
              </p>
            ) : (
              attributes.length > 0 && (
                <div className="mt-3 flex flex-col gap-3">
                  {attributes.map((a) => (
                    <div key={a.id}>
                      <label className="text-xs font-medium text-neutral-600">
                        {a.name}
                        {a.required && <span className="text-red-600"> *</span>}
                      </label>
                      {a.values ? (
                        <select
                          value={attributeAnswers[a.id] ?? ''}
                          onChange={(e) =>
                            setAttributeAnswers((prev) => ({
                              ...prev,
                              [a.id]: e.target.value,
                            }))
                          }
                          className={`${inputClassName} mt-1 w-full`}
                        >
                          <option value="">Select…</option>
                          {a.values.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={attributeAnswers[a.id] ?? ''}
                          onChange={(e) =>
                            setAttributeAnswers((prev) => ({
                              ...prev,
                              [a.id]: e.target.value,
                            }))
                          }
                          className={`${inputClassName} mt-1 w-full`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}

        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={buttonSecondaryClassName}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!category || submitting || loadingAttributes}
            onClick={handleSubmit}
            className={`${buttonPrimaryClassName} disabled:opacity-50`}
          >
            {submitting ? 'Pushing…' : 'Push to TikTok'}
          </button>
        </div>
      </Card>
    </div>
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

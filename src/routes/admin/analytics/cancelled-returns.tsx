import { useState } from 'react'
import { z } from 'zod'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { getCancelledAndReturns } from '#/server/admin/analytics'
import type { CancelledReturnsResult } from '#/server/admin/analytics'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { DATE_RANGE_PRESETS, resolveDateRange } from '#/lib/utils/date-range'
import type { DateRangePreset } from '#/lib/utils/date-range'
import { Card } from '#/components/admin/Card'
import { PageHeader } from '#/components/admin/PageHeader'
import { DateRangePicker } from '#/components/admin/DateRangePicker'
import { FilterDropdown } from '#/components/admin/FilterDropdown'
import { BarChart } from '#/components/admin/BarChart'
import { TrendLineChart } from '#/components/admin/DashboardTrendChart'
import type { OrderCancellationReason, OrderSource } from '#/types/entities'

type DrillDown =
  | { kind: 'reason'; reason: OrderCancellationReason | 'unspecified'; label: string }
  | { kind: 'channel'; source: OrderSource; label: string }
  | {
      kind: 'channelReason'
      source: OrderSource
      reason: OrderCancellationReason | 'unspecified'
      label: string
    }
  | { kind: 'returnsChannel'; source: OrderSource; label: string }

const SOURCE_LABELS: Record<OrderSource, string> = {
  storefront: 'Online Store',
  admin: 'Admin (manual)',
  tiktok_shop: 'TikTok Shop',
  shopee: 'Shopee',
  lazada: 'Lazada',
}

const REASON_LABELS: Record<OrderCancellationReason | 'unspecified', string> = {
  failed_delivery: 'Failed Delivery',
  customer_request: 'Customer Request',
  out_of_stock: 'Out of Stock',
  platform_cancelled: 'Cancelled on Marketplace',
  payment_expired: 'Payment Never Completed',
  unspecified: 'Unspecified',
}

const CHANNEL_OPTIONS = [
  { value: 'storefront', label: 'Online Store' },
  { value: 'tiktok_shop', label: 'TikTok Shop' },
  { value: 'shopee', label: 'Shopee' },
  { value: 'lazada', label: 'Lazada' },
] as const

/** The three channels staff actually track cancellations for — admin
 *  (manual) and Lazada (not yet a live sales channel) are left out of the
 *  per-channel breakdown, matching the same trim applied to the Orders
 *  page's channel filter. */
const CHANNEL_SECTION_SOURCES: OrderSource[] = [
  'storefront',
  'tiktok_shop',
  'shopee',
]

export const Route = createFileRoute('/admin/analytics/cancelled-returns')({
  validateSearch: z.object({
    range: z.enum(DATE_RANGE_PRESETS).catch('last_30_days'),
    from: z.string().optional(),
    to: z.string().optional(),
    channel: z
      .enum(['storefront', 'tiktok_shop', 'shopee', 'lazada'])
      .optional(),
    compare: z.boolean().catch(false),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => {
    const resolved = resolveDateRange(deps.range, {
      from: deps.from,
      to: deps.to,
    })
    return getCancelledAndReturns({
      data: {
        ...resolved,
        channel: deps.channel,
        comparePrevious: deps.compare,
      },
    })
  },
  component: CancelledReturnsPage,
})

function CancelledReturnsPage() {
  const result = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [drillDown, setDrillDown] = useState<DrillDown | null>(null)

  function handleRangeChange(
    preset: DateRangePreset,
    custom?: { from: string; to: string },
  ) {
    navigate({
      search: (prev) => ({
        ...prev,
        range: preset,
        from: custom?.from,
        to: custom?.to,
      }),
    })
  }

  const reasonBars = result.byReason.map((r) => ({
    label: REASON_LABELS[r.reason],
    value: r.count,
  }))
  const channelBars = result.byChannel.map((c) => ({
    label: SOURCE_LABELS[c.source],
    value: c.count,
  }))
  const returnsChannelBars = result.returns.byChannel.map((c) => ({
    label: SOURCE_LABELS[c.source],
    value: c.count,
  }))

  const byChannelAndReason = new Map(
    result.byChannelAndReason.map((c) => [c.source, c]),
  )
  const channelSections = CHANNEL_SECTION_SOURCES.map((source) => ({
    source,
    label: SOURCE_LABELS[source],
    total: byChannelAndReason.get(source)?.total ?? 0,
    bars: (byChannelAndReason.get(source)?.byReason ?? []).map((r) => ({
      label: REASON_LABELS[r.reason],
      value: r.count,
    })),
  }))

  const cancelledTrendData = result.daily.map((point, i) => ({
    label: point.date,
    current: point.count,
    previous: result.previousDaily[i]?.count ?? 0,
  }))

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Cancelled and Returns"
        subtitle="Cancellation and return trends by reason and channel."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker
              preset={search.range}
              from={search.from ?? resolveDateRange(search.range, {}).from}
              to={search.to ?? resolveDateRange(search.range, {}).to}
              onChange={handleRangeChange}
            />
            <FilterDropdown
              label="Channel"
              value={search.channel}
              options={CHANNEL_OPTIONS}
              onChange={(channel) =>
                navigate({ search: (prev) => ({ ...prev, channel }) })
              }
            />
            <button
              type="button"
              onClick={() =>
                navigate({
                  search: (prev) => ({ ...prev, compare: !prev.compare }),
                })
              }
              className={`rounded-full border px-3 py-2 text-sm font-medium ${
                search.compare
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              Compare previous period
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Cancelled Orders</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {result.totalCancelled}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Cancelled Sales</p>
          <p className="mt-1 text-xl font-semibold text-red-600">
            {formatCentsAsPHP(result.cancelledAmountCents)}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            {formatCentsAsPHP(
              result.failedDeliveryOrReturn.failedDeliveryAmountCents,
            )}{' '}
            failed delivery
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Failed Delivery / Return</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {result.failedDeliveryOrReturn.total}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            {result.failedDeliveryOrReturn.failedDeliveryCount} online store +{' '}
            {result.failedDeliveryOrReturn.marketplaceReturnsCount}{' '}
            TikTok/Shopee
          </p>
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <h2 className="text-sm font-semibold text-neutral-900">
          Cancelled Orders Over Time
        </h2>
        <p className="text-xs text-neutral-500">Cancelled order count by day</p>
        <div className="mt-4">
          <TrendLineChart
            data={cancelledTrendData}
            formatValue={(v) => `${v} cancelled`}
            color="#dc2626"
          />
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-neutral-900">
            Cancelled Orders by Reason
          </h2>
          <div className="mt-4">
            <BarChart
              bars={reasonBars}
              color="#dc2626"
              onBarClick={(i) => {
                const r = result.byReason[i]
                setDrillDown({
                  kind: 'reason',
                  reason: r.reason,
                  label: `Cancelled orders — ${REASON_LABELS[r.reason]}`,
                })
              }}
              selectedIndex={
                drillDown?.kind === 'reason'
                  ? result.byReason.findIndex(
                      (r) => r.reason === drillDown.reason,
                    )
                  : undefined
              }
            />
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-neutral-900">
            Cancelled Orders by Channel
          </h2>
          <div className="mt-4">
            <BarChart
              bars={channelBars}
              color="#171717"
              onBarClick={(i) => {
                const c = result.byChannel[i]
                setDrillDown({
                  kind: 'channel',
                  source: c.source,
                  label: `Cancelled orders — ${SOURCE_LABELS[c.source]}`,
                })
              }}
              selectedIndex={
                drillDown?.kind === 'channel'
                  ? result.byChannel.findIndex(
                      (c) => c.source === drillDown.source,
                    )
                  : undefined
              }
            />
          </div>
        </Card>
      </div>

      <h2 className="mt-8 text-sm font-semibold text-neutral-900">
        Cancellation Reasons by Channel
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {channelSections.map((section) => {
          const sectionByReason =
            byChannelAndReason.get(section.source)?.byReason ?? []
          return (
            <Card key={section.source} className="p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-neutral-900">
                  {section.label}
                </h3>
                <span className="text-xs text-neutral-500">
                  {section.total} cancelled
                </span>
              </div>
              <div className="mt-4">
                {section.bars.length > 0 ? (
                  <BarChart
                    bars={section.bars}
                    color="#dc2626"
                    onBarClick={(i) => {
                      const r = sectionByReason[i]
                      setDrillDown({
                        kind: 'channelReason',
                        source: section.source,
                        reason: r.reason,
                        label: `Cancelled orders — ${section.label} — ${REASON_LABELS[r.reason]}`,
                      })
                    }}
                    selectedIndex={
                      drillDown?.kind === 'channelReason' &&
                      drillDown.source === section.source
                        ? sectionByReason.findIndex(
                            (r) => r.reason === drillDown.reason,
                          )
                        : undefined
                    }
                  />
                ) : (
                  <p className="text-xs text-neutral-400">
                    No cancellations in this period.
                  </p>
                )}
              </div>
            </Card>
          )
        })}
      </div>

      <Card className="mt-6 p-6">
        <h2 className="text-sm font-semibold text-neutral-900">
          Returns by Channel
        </h2>
        <div className="mt-4">
          <BarChart
            bars={returnsChannelBars}
            color="#8b5cf6"
            onBarClick={(i) => {
              const c = result.returns.byChannel[i]
              setDrillDown({
                kind: 'returnsChannel',
                source: c.source,
                label: `Returns — ${SOURCE_LABELS[c.source]}`,
              })
            }}
            selectedIndex={
              drillDown?.kind === 'returnsChannel'
                ? result.returns.byChannel.findIndex(
                    (c) => c.source === drillDown.source,
                  )
                : undefined
            }
          />
        </div>
      </Card>

      {drillDown && (
        <Card className="mt-6 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">
              {drillDown.label}
            </h2>
            <button
              type="button"
              onClick={() => setDrillDown(null)}
              className="text-xs font-medium text-neutral-500 hover:text-neutral-800"
            >
              Clear
            </button>
          </div>

          {drillDown.kind === 'returnsChannel' ? (
            <ReturnsDrillDownTable
              rows={result.returnsList.filter(
                (r) => r.source === drillDown.source,
              )}
            />
          ) : (
            <CancelledDrillDownTable
              rows={result.cancelledOrdersList.filter((o) => {
                if (drillDown.kind === 'reason')
                  return o.reason === drillDown.reason
                if (drillDown.kind === 'channel')
                  return o.source === drillDown.source
                return (
                  o.source === drillDown.source && o.reason === drillDown.reason
                )
              })}
            />
          )}
        </Card>
      )}
    </div>
  )
}

function CancelledDrillDownTable({
  rows,
}: {
  rows: CancelledReturnsResult['cancelledOrdersList']
}) {
  if (rows.length === 0) {
    return (
      <p className="mt-4 text-sm text-neutral-400">
        No orders match this selection.
      </p>
    )
  }
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <th className="py-2 pr-4 font-medium">Order</th>
            <th className="py-2 pr-4 font-medium">Customer</th>
            <th className="py-2 pr-4 font-medium">Channel</th>
            <th className="py-2 pr-4 font-medium">Reason</th>
            <th className="py-2 pr-4 font-medium">Cancelled</th>
            <th className="py-2 pr-4 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((order) => (
            <tr
              key={order.id}
              className="border-b border-neutral-100 last:border-0"
            >
              <td className="py-2 pr-4">
                <Link
                  to="/admin/orders/$orderId"
                  params={{ orderId: order.id }}
                  className="font-medium text-neutral-900 hover:underline"
                >
                  {order.orderNumber}
                </Link>
              </td>
              <td className="py-2 pr-4 text-neutral-600">
                {order.customerName}
              </td>
              <td className="py-2 pr-4 text-neutral-600">
                {SOURCE_LABELS[order.source]}
              </td>
              <td className="py-2 pr-4 text-neutral-600">
                {REASON_LABELS[order.reason]}
              </td>
              <td className="py-2 pr-4 whitespace-nowrap text-neutral-500">
                {order.cancelledAt
                  ? new Date(order.cancelledAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })
                  : '—'}
              </td>
              <td className="py-2 pr-4 text-right text-neutral-900">
                {formatCentsAsPHP(order.totalCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ReturnsDrillDownTable({
  rows,
}: {
  rows: CancelledReturnsResult['returnsList']
}) {
  if (rows.length === 0) {
    return (
      <p className="mt-4 text-sm text-neutral-400">
        No returns match this selection.
      </p>
    )
  }
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
            <th className="py-2 pr-4 font-medium">Order</th>
            <th className="py-2 pr-4 font-medium">Customer</th>
            <th className="py-2 pr-4 font-medium">Channel</th>
            <th className="py-2 pr-4 font-medium">Requested</th>
            <th className="py-2 pr-4 text-right font-medium">Refund</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((ret) => (
            <tr
              key={ret.id}
              className="border-b border-neutral-100 last:border-0"
            >
              <td className="py-2 pr-4">
                <Link
                  to="/admin/orders/$orderId"
                  params={{ orderId: ret.orderId }}
                  className="font-medium text-neutral-900 hover:underline"
                >
                  {ret.orderNumber}
                </Link>
              </td>
              <td className="py-2 pr-4 text-neutral-600">
                {ret.customerName}
              </td>
              <td className="py-2 pr-4 text-neutral-600">
                {ret.source ? SOURCE_LABELS[ret.source] : '—'}
              </td>
              <td className="py-2 pr-4 whitespace-nowrap text-neutral-500">
                {new Date(ret.requestedAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </td>
              <td className="py-2 pr-4 text-right text-neutral-900">
                {formatCentsAsPHP(ret.refundAmountCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

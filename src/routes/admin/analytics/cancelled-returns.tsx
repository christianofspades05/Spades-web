import { useState } from 'react'
import { z } from 'zod'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  getCancelledAndReturns,
  getReturnIntelligence,
} from '#/server/admin/analytics'
import type {
  CancelledReturnsResult,
  ReturnIntelligenceLocationRow,
  ReturnIntelligenceResult,
  RiskLevel,
} from '#/server/admin/analytics'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { DATE_RANGE_PRESETS, resolveDateRange } from '#/lib/utils/date-range'
import type { DateRangePreset } from '#/lib/utils/date-range'
import { Card } from '#/components/admin/Card'
import { PageHeader } from '#/components/admin/PageHeader'
import { DateRangePicker } from '#/components/admin/DateRangePicker'
import { FilterDropdown } from '#/components/admin/FilterDropdown'
import { BarChart } from '#/components/admin/BarChart'
import { TrendLineChart } from '#/components/admin/DashboardTrendChart'
import {
  inputClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'
import type { OrderCancellationReason, OrderSource } from '#/types/entities'

const MIN_SAMPLE_OPTIONS = [5, 10, 20, 30, 50] as const

const RISK_LABELS: Record<RiskLevel, string> = {
  green: 'Normal COD',
  yellow: 'Monitor',
  orange: 'COD Confirmation',
  red: 'Prepaid Recommended',
  insufficient_data: 'Not enough data',
}

const RISK_BADGE_CLASSES: Record<RiskLevel, string> = {
  green: 'bg-emerald-100 text-emerald-700',
  yellow: 'bg-amber-100 text-amber-700',
  orange: 'bg-orange-100 text-orange-700',
  red: 'bg-red-100 text-red-700',
  insufficient_data: 'bg-neutral-100 text-neutral-500',
}

function formatPct(value: number | null, digits = 1): string {
  return value === null ? '—' : `${value.toFixed(digits)}%`
}

function DeltaBadge({
  current,
  previous,
  /** Return-rate-shaped metrics are "bad when up" — an increase gets red,
   *  a decrease gets green. Pass false for a metric where up is good. */
  badWhenUp = true,
  suffix = 'pts',
}: {
  current: number | null
  previous: number | null | undefined
  badWhenUp?: boolean
  suffix?: string
}) {
  if (current === null || previous === null || previous === undefined) {
    return null
  }
  const delta = current - previous
  const rounded = Math.round(delta * 10) / 10
  if (rounded === 0) {
    return (
      <p className="mt-0.5 text-xs text-neutral-400">
        No change vs previous period
      </p>
    )
  }
  const improving = badWhenUp ? rounded < 0 : rounded > 0
  return (
    <p
      className={`mt-0.5 text-xs ${improving ? 'text-emerald-600' : 'text-red-600'}`}
    >
      {rounded > 0 ? '↑' : '↓'} {Math.abs(rounded).toFixed(1)} {suffix} vs
      previous period
    </p>
  )
}

type DrillDown =
  | {
      kind: 'reason'
      reason: OrderCancellationReason | 'unspecified'
      label: string
    }
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
    range: z.enum(DATE_RANGE_PRESETS).catch('this_month'),
    from: z.string().optional(),
    to: z.string().optional(),
    channel: z
      .enum(['storefront', 'tiktok_shop', 'shopee', 'lazada'])
      .optional(),
    compare: z.boolean().catch(false),
    minSample: z
      .union([
        z.literal(5),
        z.literal(10),
        z.literal(20),
        z.literal(30),
        z.literal(50),
      ])
      .catch(10),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const resolved = resolveDateRange(deps.range, {
      from: deps.from,
      to: deps.to,
    })
    const [cancelledAndReturns, returnIntelligence] = await Promise.all([
      getCancelledAndReturns({
        data: {
          ...resolved,
          channel: deps.channel,
          comparePrevious: deps.compare,
        },
      }),
      getReturnIntelligence({
        data: {
          ...resolved,
          channel: deps.channel,
          comparePrevious: true,
          minMaturedSample: deps.minSample,
        },
      }),
    ])
    return { cancelledAndReturns, returnIntelligence }
  },
  component: CancelledReturnsPage,
})

function CancelledReturnsPage() {
  const loaderData = Route.useLoaderData()
  const result = loaderData.cancelledAndReturns
  const returnIntelligence = loaderData.returnIntelligence
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [drillDown, setDrillDown] = useState<DrillDown | null>(null)
  const [pageTab, setPageTab] = useState<
    'executive' | 'reasons' | 'geographic' | 'codRisk' | 'crossPeriod'
  >('executive')

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

      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-neutral-200">
        {(
          [
            { key: 'executive', label: 'Executive Overview' },
            { key: 'geographic', label: 'Geographic Risk' },
            { key: 'codRisk', label: 'COD Risk' },
            { key: 'reasons', label: 'Reasons & Channels' },
            {
              key: 'crossPeriod',
              label: 'Cross Period Returns',
              badge:
                result.crossPeriod.cancelledCount +
                  result.crossPeriod.returnsCount || undefined,
            },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setPageTab(tab.key)}
            className={`border-b-2 px-3 pb-2 text-xs font-semibold tracking-wider uppercase transition ${
              pageTab === tab.key
                ? 'border-neutral-900 text-neutral-900'
                : 'border-transparent text-neutral-400 hover:text-neutral-600'
            }`}
          >
            {tab.label}
            {'badge' in tab && tab.badge !== undefined && (
              <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 normal-case">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {returnIntelligence.dataNotes.length > 0 && (
        <DataQualityNotice notes={returnIntelligence.dataNotes} />
      )}

      {pageTab === 'executive' && (
        <ExecutiveOverviewTab result={returnIntelligence} />
      )}

      {pageTab === 'geographic' && (
        <GeographicTab
          result={returnIntelligence}
          minSample={search.minSample}
          onMinSampleChange={(minSample) =>
            navigate({ search: (prev) => ({ ...prev, minSample }) })
          }
        />
      )}

      {pageTab === 'codRisk' && (
        <CodRiskTab
          result={returnIntelligence}
          minSample={search.minSample}
          onMinSampleChange={(minSample) =>
            navigate({ search: (prev) => ({ ...prev, minSample }) })
          }
        />
      )}

      {pageTab === 'reasons' && (
        <>
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
              <p className="text-xs text-neutral-500">
                Failed Delivery / Return
              </p>
              <p className="mt-1 text-xl font-semibold text-neutral-900">
                {result.failedDeliveryOrReturn.total}
              </p>
              <p className="mt-0.5 text-xs text-neutral-400">
                {result.failedDeliveryOrReturn.failedDeliveryCount} online store
                + {result.failedDeliveryOrReturn.marketplaceReturnsCount}{' '}
                TikTok/Shopee
              </p>
            </Card>
          </div>

          <Card className="mt-4 p-5">
            <h2 className="text-sm font-semibold text-neutral-900">
              Cancelled Orders Over Time
            </h2>
            <p className="text-xs text-neutral-500">
              Cancelled order count by day
            </p>
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
                      o.source === drillDown.source &&
                      o.reason === drillDown.reason
                    )
                  })}
                />
              )}
            </Card>
          )}
        </>
      )}
      {pageTab === 'crossPeriod' && (
        <CrossPeriodTab crossPeriod={result.crossPeriod} />
      )}
    </div>
  )
}

function CrossPeriodTab({
  crossPeriod,
}: {
  crossPeriod: CancelledReturnsResult['crossPeriod']
}) {
  return (
    <div>
      <p className="mb-4 text-sm text-neutral-500">
        Orders placed in one calendar month but cancelled or returned in a later
        one — easy to miss when a month's sales get reconciled against that same
        month's cancellations alone, since these show up as a surprise deduction
        the following month instead.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Cross-Period Cancellations</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {crossPeriod.cancelledCount}
          </p>
          <p className="mt-0.5 text-xs text-red-600">
            {formatCentsAsPHP(crossPeriod.cancelledAmountCents)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Cross-Period Returns</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {crossPeriod.returnsCount}
          </p>
          <p className="mt-0.5 text-xs text-purple-600">
            {formatCentsAsPHP(crossPeriod.returnsRefundCents)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Total Cross-Period Impact</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {crossPeriod.cancelledCount + crossPeriod.returnsCount}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            {formatCentsAsPHP(
              crossPeriod.cancelledAmountCents + crossPeriod.returnsRefundCents,
            )}
          </p>
        </Card>
      </div>

      <Card className="mt-4 p-6">
        <h2 className="text-sm font-semibold text-neutral-900">
          Cross-Period Orders
        </h2>
        <p className="text-xs text-neutral-500">
          Within the selected range, sorted by most recent event.
        </p>
        {crossPeriod.orders.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-400">
            No cross-period cancellations or returns in this range.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                  <th className="py-2 pr-4 font-medium">Order</th>
                  <th className="py-2 pr-4 font-medium">Customer</th>
                  <th className="py-2 pr-4 font-medium">Channel</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">Placed</th>
                  <th className="py-2 pr-4 font-medium">Event</th>
                  <th className="py-2 pr-4 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {crossPeriod.orders.map((order) => (
                  <tr
                    key={`${order.kind}-${order.id}`}
                    className="border-b border-neutral-100 last:border-0"
                  >
                    <td className="py-2 pr-4">
                      <Link
                        to="/admin/orders/$orderId"
                        params={{ orderId: order.orderId }}
                        className="font-medium text-neutral-900 hover:underline"
                      >
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-neutral-600">
                      {order.customerName}
                    </td>
                    <td className="py-2 pr-4 text-neutral-600">
                      {order.source ? SOURCE_LABELS[order.source] : '—'}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          order.kind === 'cancelled'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-purple-50 text-purple-700'
                        }`}
                      >
                        {order.kind === 'cancelled' ? 'Cancelled' : 'Returned'}
                      </span>
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap text-neutral-500">
                      {new Date(order.placedAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap text-neutral-500">
                      {new Date(order.eventAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="py-2 pr-4 text-right text-neutral-900">
                      {formatCentsAsPHP(order.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
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
              <td className="py-2 pr-4 text-neutral-600">{ret.customerName}</td>
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

function DataQualityNotice({ notes }: { notes: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Card className="mb-4 border-amber-200 bg-amber-50/60 p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-xs font-semibold text-amber-800">
          Data quality notes — read before trusting a number on this page
        </span>
        <span className="text-xs text-amber-700">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <ul className="mt-3 list-disc space-y-1.5 pl-4 text-xs text-amber-800">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function MinSampleControl({
  value,
  onChange,
}: {
  value: (typeof MIN_SAMPLE_OPTIONS)[number]
  onChange: (value: (typeof MIN_SAMPLE_OPTIONS)[number]) => void
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-medium text-neutral-600">
      Minimum matured orders
      <select
        value={value}
        onChange={(e) =>
          onChange(
            Number(e.target.value) as (typeof MIN_SAMPLE_OPTIONS)[number],
          )
        }
        className={`${inputClassName} w-auto py-1.5 text-xs`}
      >
        {MIN_SAMPLE_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  )
}

function ExecutiveOverviewTab({
  result,
}: {
  result: ReturnIntelligenceResult
}) {
  const k = result.kpis
  const prev = result.previousKpis

  const trendData = result.trend.map((point, i) => ({
    label: point.date,
    current: point.returnRatePct ?? 0,
    previous: result.previousTrend?.[i]?.returnRatePct ?? 0,
  }))
  const salesTrendData = result.trend.map((point, i) => ({
    label: point.date,
    current: point.returnedSalesCents,
    previous: result.previousTrend?.[i]?.returnedSalesCents ?? 0,
  }))

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Total Orders</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {k.totalOrders}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Matured Orders</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {k.maturedOrders}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            Delivered + Returned only — excludes in-transit and pre-shipment
            cancellations
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Delivered Orders</p>
          <p className="mt-1 text-xl font-semibold text-emerald-600">
            {k.deliveredOrders}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Returned Orders</p>
          <p className="mt-1 text-xl font-semibold text-red-600">
            {k.returnedOrders}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            {k.rtsOrders} RTS + {k.buyerReturnOrders} buyer return
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">For Return / Pending RTS</p>
          <p className="mt-1 text-xl font-semibold text-amber-600">
            {k.pendingReturnOrders}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            At-risk, not yet final
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Overall Return Rate</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {formatPct(k.returnRatePct)}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            of {k.maturedOrders} matured orders
          </p>
          <DeltaBadge
            current={k.returnRatePct}
            previous={prev?.returnRatePct}
          />
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">
            Failed Delivery Sales Value
          </p>
          <p className="mt-1 text-xl font-semibold text-red-600">
            {formatCentsAsPHP(k.returnedSalesCents)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Estimated Return Cost</p>
          <p className="mt-1 text-xl font-semibold text-red-600">
            {formatCentsAsPHP(k.estimatedReturnCostCents)}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            Estimate — see data notes
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Avg Returned Order Value</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {formatCentsAsPHP(k.avgReturnedOrderValueCents)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">COD Return Rate</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {formatPct(k.codReturnRatePct)}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            of {k.codMaturedOrders} matured COD orders
          </p>
          <DeltaBadge
            current={k.codReturnRatePct}
            previous={prev?.codReturnRatePct}
          />
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Prepaid Return Rate</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {formatPct(k.prepaidReturnRatePct)}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            of {k.prepaidMaturedOrders} matured prepaid orders
          </p>
          <DeltaBadge
            current={k.prepaidReturnRatePct}
            previous={prev?.prepaidReturnRatePct}
          />
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">
            Return Cost vs Previous Period
          </p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {formatCentsAsPHP(k.estimatedReturnCostCents)}
          </p>
          {prev && (
            <p
              className={`mt-0.5 text-xs ${
                k.estimatedReturnCostCents <= prev.estimatedReturnCostCents
                  ? 'text-emerald-600'
                  : 'text-red-600'
              }`}
            >
              was {formatCentsAsPHP(prev.estimatedReturnCostCents)}
            </p>
          )}
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <h2 className="text-sm font-semibold text-neutral-900">
          Return Rate Over Time
        </h2>
        <p className="text-xs text-neutral-500">
          Daily return rate — current vs previous period
        </p>
        <div className="mt-4">
          <TrendLineChart
            data={trendData}
            formatValue={(v) => `${v.toFixed(1)}%`}
            color="#dc2626"
          />
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="text-sm font-semibold text-neutral-900">
          Returned Sales Value Over Time
        </h2>
        <p className="text-xs text-neutral-500">
          Whether the financial damage from returns is growing
        </p>
        <div className="mt-4">
          <TrendLineChart
            data={salesTrendData}
            formatValue={(v) => formatCentsAsPHP(v)}
            color="#dc2626"
          />
        </div>
      </Card>
    </div>
  )
}

function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${RISK_BADGE_CLASSES[level]}`}
    >
      {RISK_LABELS[level]}
    </span>
  )
}

type LocationSort =
  | 'returnRate'
  | 'returnedOrders'
  | 'returnedSales'
  | 'returnCost'
  | 'totalOrders'

function sortLocations(
  rows: ReturnIntelligenceLocationRow[],
  sort: LocationSort,
): ReturnIntelligenceLocationRow[] {
  const sorted = [...rows]
  switch (sort) {
    case 'returnedOrders':
      return sorted.sort((a, b) => b.returnedOrders - a.returnedOrders)
    case 'returnedSales':
      return sorted.sort((a, b) => b.returnedSalesCents - a.returnedSalesCents)
    case 'returnCost':
      return sorted.sort(
        (a, b) => b.estimatedReturnCostCents - a.estimatedReturnCostCents,
      )
    case 'totalOrders':
      return sorted.sort((a, b) => b.totalOrders - a.totalOrders)
    case 'returnRate':
    default:
      return sorted.sort(
        (a, b) => (b.returnRatePct ?? -1) - (a.returnRatePct ?? -1),
      )
  }
}

function LocationTable({ rows }: { rows: ReturnIntelligenceLocationRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-neutral-400">
        No orders with usable location data in this range.
      </p>
    )
  }
  return (
    <div className={`${tableWrapperClassName} mt-4`}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className={tableHeadClassName}>Location</th>
              <th className={`${tableHeadClassName} text-right`}>Orders</th>
              <th className={`${tableHeadClassName} text-right`}>Matured</th>
              <th className={`${tableHeadClassName} text-right`}>Delivered</th>
              <th className={`${tableHeadClassName} text-right`}>Returned</th>
              <th className={`${tableHeadClassName} text-right`}>For Return</th>
              <th className={`${tableHeadClassName} text-right`}>
                Return Rate
              </th>
              <th className={`${tableHeadClassName} text-right`}>
                Returned Sales
              </th>
              <th className={`${tableHeadClassName} text-right`}>
                COD Return Rate
              </th>
              <th className={`${tableHeadClassName} text-right`}>
                Avg Order Value
              </th>
              <th className={`${tableHeadClassName} text-right`}>
                Est. Return Cost
              </th>
              <th className={tableHeadClassName}>Risk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.location} className={tableRowClassName}>
                <td className={`${tableCellClassName} font-medium`}>
                  {row.location}
                  {row.parentProvince && (
                    <span className="ml-1.5 text-xs font-normal text-neutral-400">
                      {row.parentProvince}
                    </span>
                  )}
                </td>
                <td className={`${tableCellClassName} text-right`}>
                  {row.totalOrders}
                </td>
                <td className={`${tableCellClassName} text-right`}>
                  {row.maturedOrders}
                </td>
                <td
                  className={`${tableCellClassName} text-right text-emerald-600`}
                >
                  {row.deliveredOrders}
                </td>
                <td className={`${tableCellClassName} text-right text-red-600`}>
                  {row.returnedOrders}
                </td>
                <td
                  className={`${tableCellClassName} text-right text-amber-600`}
                >
                  {row.pendingReturnOrders}
                </td>
                <td
                  className={`${tableCellClassName} text-right font-semibold`}
                >
                  {formatPct(row.returnRatePct)}
                  <span className="ml-1 text-xs font-normal text-neutral-400">
                    (n={row.maturedOrders})
                  </span>
                </td>
                <td className={`${tableCellClassName} text-right`}>
                  {formatCentsAsPHP(row.returnedSalesCents)}
                </td>
                <td className={`${tableCellClassName} text-right`}>
                  {formatPct(row.codReturnRatePct)}
                </td>
                <td className={`${tableCellClassName} text-right`}>
                  {formatCentsAsPHP(row.avgOrderValueCents)}
                </td>
                <td className={`${tableCellClassName} text-right`}>
                  {formatCentsAsPHP(row.estimatedReturnCostCents)}
                </td>
                <td className={tableCellClassName}>
                  <RiskBadge level={row.riskLevel} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GeographicTab({
  result,
  minSample,
  onMinSampleChange,
}: {
  result: ReturnIntelligenceResult
  minSample: (typeof MIN_SAMPLE_OPTIONS)[number]
  onMinSampleChange: (value: (typeof MIN_SAMPLE_OPTIONS)[number]) => void
}) {
  const [geoTab, setGeoTab] = useState<'provinces' | 'cities'>('provinces')
  const [sort, setSort] = useState<LocationSort>('returnRate')
  const [search, setSearch] = useState('')

  const rawRows = geoTab === 'provinces' ? result.provinces : result.cities
  const filtered = search
    ? rawRows.filter((r) =>
        r.location.toLowerCase().includes(search.toLowerCase()),
      )
    : rawRows
  const rows = sortLocations(filtered, sort)

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">
            Geographic Return Intelligence
          </h2>
          <p className="text-xs text-neutral-500">
            Ranked by return rate, not raw count — a location needs at least{' '}
            {minSample} matured orders to get a risk rating.
          </p>
        </div>
        <MinSampleControl value={minSample} onChange={onMinSampleChange} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-neutral-200 p-0.5">
          {(['provinces', 'cities'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setGeoTab(tab)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${
                geoTab === tab
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-500 hover:bg-neutral-50'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${geoTab}…`}
          className={`${inputClassName} w-56`}
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as LocationSort)}
          className={`${inputClassName} w-auto`}
        >
          <option value="returnRate">Sort: Highest return rate</option>
          <option value="returnedOrders">Sort: Most returns</option>
          <option value="returnedSales">Sort: Highest returned value</option>
          <option value="returnCost">Sort: Highest return cost</option>
          <option value="totalOrders">Sort: Most orders</option>
        </select>
      </div>

      {geoTab === 'cities' && (
        <p className="mt-3 text-xs text-neutral-400">
          Cities are Online Store only — TikTok Shop's address data doesn't go
          below province level, and Shopee's is fully masked. See data notes
          above.
        </p>
      )}

      <LocationTable rows={rows} />
    </Card>
  )
}

function CodRiskTab({
  result,
  minSample,
  onMinSampleChange,
}: {
  result: ReturnIntelligenceResult
  minSample: (typeof MIN_SAMPLE_OPTIONS)[number]
  onMinSampleChange: (value: (typeof MIN_SAMPLE_OPTIONS)[number]) => void
}) {
  const rows = [...result.provinces].sort(
    (a, b) => (b.codReturnRatePct ?? -1) - (a.codReturnRatePct ?? -1),
  )

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">
            COD Risk Map
          </h2>
          <p className="text-xs text-neutral-500">
            Recommendations only — nothing here disables COD automatically.
            Green &lt;10% · Yellow 10–20% · Orange 20–30% · Red &gt;30%,
            provinces only, requires at least {minSample} matured orders.
          </p>
        </div>
        <MinSampleControl value={minSample} onChange={onMinSampleChange} />
      </div>

      <div className={`${tableWrapperClassName} mt-4`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={tableHeadClassName}>Province</th>
                <th className={`${tableHeadClassName} text-right`}>
                  Return Rate
                </th>
                <th className={`${tableHeadClassName} text-right`}>
                  Sample Size
                </th>
                <th className={`${tableHeadClassName} text-right`}>
                  COD Return Rate
                </th>
                <th className={`${tableHeadClassName} text-right`}>
                  Returned COD Value
                </th>
                <th className={tableHeadClassName}>Risk Level</th>
                <th className={tableHeadClassName}>Recommended Policy</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.location} className={tableRowClassName}>
                  <td className={`${tableCellClassName} font-medium`}>
                    {row.location}
                  </td>
                  <td className={`${tableCellClassName} text-right`}>
                    {formatPct(row.returnRatePct)}
                  </td>
                  <td
                    className={`${tableCellClassName} text-right text-neutral-500`}
                  >
                    {row.maturedOrders}
                  </td>
                  <td className={`${tableCellClassName} text-right`}>
                    {formatPct(row.codReturnRatePct)}
                  </td>
                  <td className={`${tableCellClassName} text-right`}>
                    {formatCentsAsPHP(row.returnedSalesCents)}
                  </td>
                  <td className={tableCellClassName}>
                    <RiskBadge level={row.riskLevel} />
                  </td>
                  <td className={`${tableCellClassName} text-neutral-600`}>
                    {RISK_LABELS[row.riskLevel]}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="py-8 text-center text-sm text-neutral-400"
                  >
                    No province-level data in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  )
}

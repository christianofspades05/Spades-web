import { z } from 'zod'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { getCancelledAndReturns } from '#/server/admin/analytics'
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
      data: { ...resolved, channel: deps.channel, comparePrevious: deps.compare },
    })
  },
  component: CancelledReturnsPage,
})

function CancelledReturnsPage() {
  const result = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

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
            <BarChart bars={reasonBars} color="#dc2626" />
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-neutral-900">
            Cancelled Orders by Channel
          </h2>
          <div className="mt-4">
            <BarChart bars={channelBars} color="#171717" />
          </div>
        </Card>
      </div>

      <h2 className="mt-8 text-sm font-semibold text-neutral-900">
        Cancellation Reasons by Channel
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {channelSections.map((section) => (
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
                <BarChart bars={section.bars} color="#dc2626" />
              ) : (
                <p className="text-xs text-neutral-400">
                  No cancellations in this period.
                </p>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-6 p-6">
        <h2 className="text-sm font-semibold text-neutral-900">
          Returns by Channel
        </h2>
        <div className="mt-4">
          <BarChart bars={returnsChannelBars} color="#8b5cf6" />
        </div>
      </Card>
    </div>
  )
}

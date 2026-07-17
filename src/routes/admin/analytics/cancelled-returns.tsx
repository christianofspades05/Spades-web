import { z } from 'zod'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { getCancelledAndReturns } from '#/server/admin/analytics'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { DATE_RANGE_PRESETS, resolveDateRange } from '#/lib/utils/date-range'
import type { DateRangePreset } from '#/lib/utils/date-range'
import { Card } from '#/components/admin/Card'
import { PageHeader } from '#/components/admin/PageHeader'
import { DateRangePicker } from '#/components/admin/DateRangePicker'
import { LineChart } from '#/components/admin/LineChart'
import { BarChart } from '#/components/admin/BarChart'
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
  unspecified: 'Unspecified',
}

export const Route = createFileRoute('/admin/analytics/cancelled-returns')({
  validateSearch: z.object({
    range: z.enum(DATE_RANGE_PRESETS).catch('last_30_days'),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => {
    const resolved = resolveDateRange(deps.range, {
      from: deps.from,
      to: deps.to,
    })
    return getCancelledAndReturns({ data: resolved })
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

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <div className="flex items-start justify-between">
        <PageHeader
          title="Cancelled and Returns"
          subtitle="Cancellation and return trends by reason and channel."
        />
        <DateRangePicker
          preset={search.range}
          from={search.from ?? resolveDateRange(search.range, {}).from}
          to={search.to ?? resolveDateRange(search.range, {}).to}
          onChange={handleRangeChange}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Cancelled Orders</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {result.totalCancelled}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-neutral-500">Returns</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {result.returns.totalCount}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            {formatCentsAsPHP(result.returns.totalRefundCents)} refunded
          </p>
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <h2 className="text-sm font-semibold text-neutral-900">
          Cancelled Orders Over Time
        </h2>
        <div className="mt-4">
          <LineChart
            values={result.daily.map((d) => d.count)}
            color="#dc2626"
          />
        </div>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
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

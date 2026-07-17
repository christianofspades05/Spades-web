import { z } from 'zod'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { getSalesByChannel } from '#/server/admin/analytics'
import { formatCentsAsPHP } from '#/lib/utils/money'
import {
  DATE_RANGE_PRESETS,
  percentChange,
  resolveDateRange,
} from '#/lib/utils/date-range'
import type { DateRangePreset } from '#/lib/utils/date-range'
import { Card } from '#/components/admin/Card'
import { PageHeader } from '#/components/admin/PageHeader'
import { DateRangePicker } from '#/components/admin/DateRangePicker'
import { DonutChart } from '#/components/admin/DonutChart'
import { inputClassName } from '#/components/admin/ui'
import type { OrderSource } from '#/types/entities'

const SOURCE_LABELS: Record<OrderSource, string> = {
  storefront: 'Online Store',
  admin: 'Admin (manual)',
  tiktok_shop: 'TikTok Shop',
  shopee: 'Shopee',
  lazada: 'Lazada',
}

const CHANNEL_COLORS: Record<OrderSource, string> = {
  storefront: '#171717',
  tiktok_shop: '#34d399',
  shopee: '#fb923c',
  lazada: '#8b5cf6',
  admin: '#94a3b8',
}

export const Route = createFileRoute('/admin/analytics/sales')({
  validateSearch: z.object({
    range: z.enum(DATE_RANGE_PRESETS).catch('last_30_days'),
    from: z.string().optional(),
    to: z.string().optional(),
    channel: z
      .enum(['storefront', 'admin', 'tiktok_shop', 'shopee', 'lazada'])
      .optional(),
    compare: z.boolean().catch(false),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => {
    const resolved = resolveDateRange(deps.range, {
      from: deps.from,
      to: deps.to,
    })
    return getSalesByChannel({
      data: {
        ...resolved,
        channel: deps.channel,
        comparePrevious: deps.compare,
      },
    })
  },
  component: SalesPage,
})

function SalesPage() {
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

  const slices = result.channels.map((c) => ({
    label: SOURCE_LABELS[c.source],
    value: c.grossSalesCents,
    color: CHANNEL_COLORS[c.source],
  }))
  const prevBySource = new Map(
    (result.previous?.channels ?? []).map((c) => [c.source, c]),
  )

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <div className="flex items-start justify-between">
        <PageHeader title="Sales" subtitle="Gross sales by channel." />
        <div className="flex items-center gap-2">
          <DateRangePicker
            preset={search.range}
            from={search.from ?? resolveDateRange(search.range, {}).from}
            to={search.to ?? resolveDateRange(search.range, {}).to}
            onChange={handleRangeChange}
          />
          <select
            value={search.channel ?? ''}
            onChange={(e) =>
              navigate({
                search: (prev) => ({
                  ...prev,
                  channel: (e.target.value || undefined) as
                    OrderSource | undefined,
                }),
              })
            }
            className={inputClassName}
          >
            <option value="">All Channels</option>
            {(Object.keys(SOURCE_LABELS) as OrderSource[]).map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
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
      </div>

      <Card className="mt-6 p-6">
        <h2 className="text-sm font-semibold text-neutral-900">
          Sales by Channel
        </h2>
        <p className="text-xs text-neutral-500">Share of gross sales</p>

        <div className="mt-6 flex flex-wrap items-center gap-10">
          <DonutChart slices={slices} />
          <div className="flex flex-col gap-3">
            {result.channels.map((c) => (
              <div
                key={c.source}
                className="flex items-center justify-between gap-8"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: CHANNEL_COLORS[c.source] }}
                  />
                  <span className="text-sm text-neutral-700">
                    {SOURCE_LABELS[c.source]}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-neutral-900">
                    {formatCentsAsPHP(c.grossSalesCents)}
                  </p>
                  <p className="text-xs text-neutral-400">
                    {result.totals.grossSalesCents > 0
                      ? Math.round(
                          (c.grossSalesCents / result.totals.grossSalesCents) *
                            100,
                        )
                      : 0}
                    %
                  </p>
                </div>
              </div>
            ))}
            {result.channels.length === 0 && (
              <p className="text-sm text-neutral-400">
                No sales in this range.
              </p>
            )}
          </div>
        </div>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {result.channels.map((c) => {
          const prev = prevBySource.get(c.source)
          const salesChange = prev
            ? percentChange(c.grossSalesCents, prev.grossSalesCents)
            : null
          return (
            <Card key={c.source} className="p-5">
              <span className="inline-block rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-600">
                {SOURCE_LABELS[c.source]}
              </span>

              <div className="mt-4">
                <p className="text-xs text-neutral-500">Gross Sales</p>
                <p className="mt-1 text-xl font-semibold text-neutral-900">
                  {formatCentsAsPHP(c.grossSalesCents)}
                </p>
                {salesChange !== null && (
                  <p
                    className={`mt-0.5 text-xs ${
                      salesChange >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}
                  >
                    {salesChange >= 0 ? '+' : ''}
                    {salesChange}% vs previous period
                  </p>
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-neutral-500">Orders</p>
                  <p className="mt-1 text-sm font-semibold text-neutral-900">
                    {c.orderCount}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-neutral-500">Avg. Order Value</p>
                  <p className="mt-1 text-sm font-semibold text-neutral-900">
                    {formatCentsAsPHP(
                      c.orderCount > 0
                        ? Math.round(c.grossSalesCents / c.orderCount)
                        : 0,
                    )}
                  </p>
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

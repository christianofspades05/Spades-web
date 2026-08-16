import type { ReactNode } from 'react'
import { z } from 'zod'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Building2, Globe } from 'lucide-react'
import { getVisitorAnalytics } from '#/server/admin/analytics'
import type {
  VisitorCityRow,
  VisitorCountryRow,
} from '#/server/admin/analytics'
import { DATE_RANGE_PRESETS, percentChange, resolveDateRange } from '#/lib/utils/date-range'
import type { DateRangePreset } from '#/lib/utils/date-range'
import {
  STOREFRONT_BRAND_LABELS,
  STOREFRONT_BRANDS,
} from '#/lib/validation/admin/storefront-sections'
import { Card } from '#/components/admin/Card'
import { PageHeader } from '#/components/admin/PageHeader'
import { DateRangePicker } from '#/components/admin/DateRangePicker'
import { FilterDropdown } from '#/components/admin/FilterDropdown'
import { BarChart } from '#/components/admin/BarChart'
import {
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

const BRAND_OPTIONS = STOREFRONT_BRANDS.map((brand) => ({
  value: brand,
  label: STOREFRONT_BRAND_LABELS[brand],
}))

const TOP_LOCATIONS_CHART_COUNT = 10

export const Route = createFileRoute('/admin/analytics/visitors')({
  validateSearch: z.object({
    range: z.enum(DATE_RANGE_PRESETS).catch('last_30_days'),
    from: z.string().optional(),
    to: z.string().optional(),
    brand: z.enum(STOREFRONT_BRANDS).optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const resolved = resolveDateRange(deps.range, {
      from: deps.from,
      to: deps.to,
    })
    return getVisitorAnalytics({ data: { ...resolved, brand: deps.brand } })
  },
  component: VisitorsPage,
})

function TrendTag({ value }: { value: number | null }) {
  if (value === null) return null
  const tone = value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'
  const colorClass =
    tone === 'positive'
      ? 'text-green-700 bg-green-50'
      : tone === 'negative'
        ? 'text-red-700 bg-red-50'
        : 'text-neutral-600 bg-neutral-100'
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}
    >
      {value > 0 ? '+' : ''}
      {value}%
    </span>
  )
}

interface BreakdownRow {
  key: string
  label: string
  uniqueVisitors: number
  pageViews: number
}

function LocationBreakdownCard({
  title,
  subtitle,
  icon,
  rows,
  emptyMessage,
}: {
  title: string
  subtitle: string
  icon: ReactNode
  rows: BreakdownRow[]
  emptyMessage: string
}) {
  const totalVisitors = rows.reduce((sum, r) => sum + r.uniqueVisitors, 0)

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
      <p className="text-xs text-neutral-500">{subtitle}</p>

      <div className="mt-4">
        <BarChart
          bars={rows.slice(0, TOP_LOCATIONS_CHART_COUNT).map((r) => ({
            label: r.label,
            value: r.uniqueVisitors,
          }))}
        />
      </div>

      {rows.length > 0 ? (
        <div className={`${tableWrapperClassName} mt-5`}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClassName}>Location</th>
                  <th className={`${tableHeadClassName} text-right`}>
                    Visitors
                  </th>
                  <th className={`${tableHeadClassName} text-right`}>
                    Page views
                  </th>
                  <th className={`${tableHeadClassName} text-right`}>
                    Share
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className={tableRowClassName}>
                    <td className={`${tableCellClassName} font-medium`}>
                      <div className="flex items-center gap-2">
                        {icon}
                        {row.label}
                      </div>
                    </td>
                    <td className={`${tableCellClassName} text-right`}>
                      {row.uniqueVisitors.toLocaleString()}
                    </td>
                    <td className={`${tableCellClassName} text-right`}>
                      {row.pageViews.toLocaleString()}
                    </td>
                    <td
                      className={`${tableCellClassName} text-right text-neutral-500`}
                    >
                      {totalVisitors > 0
                        ? `${((row.uniqueVisitors / totalVisitors) * 100).toFixed(1)}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="mt-5 text-sm text-neutral-400">{emptyMessage}</p>
      )}
    </Card>
  )
}

function countryRowsToBreakdown(rows: VisitorCountryRow[]): BreakdownRow[] {
  return rows.map((r) => ({
    key: r.country ?? 'unknown',
    label: r.countryName,
    uniqueVisitors: r.uniqueVisitors,
    pageViews: r.pageViews,
  }))
}

function cityRowsToBreakdown(rows: VisitorCityRow[]): BreakdownRow[] {
  return rows.map((r) => ({
    key: `${r.city}|${r.country ?? ''}`,
    label: r.country ? `${r.city}, ${r.countryName}` : r.city,
    uniqueVisitors: r.uniqueVisitors,
    pageViews: r.pageViews,
  }))
}

function VisitorsPage() {
  const data = Route.useLoaderData()
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

  const visitorsTrend = percentChange(data.uniqueVisitors, data.previousUniqueVisitors)
  const pageViewsTrend = percentChange(data.pageViews, data.previousPageViews)

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Visitors"
        subtitle="Online store traffic and where visitors are browsing from."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <FilterDropdown
              label="Brand"
              value={search.brand}
              options={BRAND_OPTIONS}
              onChange={(brand) => navigate({ search: (prev) => ({ ...prev, brand }) })}
            />
            <DateRangePicker
              preset={search.range}
              from={search.from ?? resolveDateRange(search.range, {}).from}
              to={search.to ?? resolveDateRange(search.range, {}).to}
              onChange={handleRangeChange}
            />
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <p className="text-sm font-medium text-neutral-500">Visitors</p>
          <div className="mt-2 flex items-end justify-between">
            <p className="text-3xl font-semibold text-neutral-900">
              {data.uniqueVisitors.toLocaleString()}
            </p>
            <TrendTag value={visitorsTrend} />
          </div>
          <p className="mt-1 text-xs text-neutral-400">
            Unique visitors, online store only
          </p>
        </Card>

        <Card className="p-5">
          <p className="text-sm font-medium text-neutral-500">Page views</p>
          <div className="mt-2 flex items-end justify-between">
            <p className="text-3xl font-semibold text-neutral-900">
              {data.pageViews.toLocaleString()}
            </p>
            <TrendTag value={pageViewsTrend} />
          </div>
          <p className="mt-1 text-xs text-neutral-400">
            vs previous period
          </p>
        </Card>
      </div>

      <div className="mt-4">
        <LocationBreakdownCard
          title="Top Locations"
          subtitle="Visitors by city — best-effort from IP geolocation. Visits with no detected city are left out of this breakdown."
          icon={<Building2 size={14} className="text-neutral-300" />}
          rows={cityRowsToBreakdown(data.cities)}
          emptyMessage="No visits with a detected city in this range."
        />
      </div>

      <div className="mt-4">
        <LocationBreakdownCard
          title="Top Countries"
          subtitle="Visitors by country — best-effort from IP geolocation, so a visit with no detected location shows as Unknown."
          icon={<Globe size={14} className="text-neutral-300" />}
          rows={countryRowsToBreakdown(data.countries)}
          emptyMessage="No visits in this range."
        />
      </div>
    </div>
  )
}

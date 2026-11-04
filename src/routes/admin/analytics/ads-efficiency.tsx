import { z } from 'zod'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { getAdsEfficiency } from '#/server/admin/ads-efficiency'
import type { AdsEfficiencyTotals } from '#/server/admin/ads-efficiency'
import {
  DATE_RANGE_PRESETS,
  percentChange,
  resolveDateRange,
} from '#/lib/utils/date-range'
import { formatCentsAsPHP } from '#/lib/utils/money'
import {
  STOREFRONT_BRAND_LABELS,
  STOREFRONT_BRANDS,
} from '#/lib/validation/admin/storefront-sections'
import { Card } from '#/components/admin/Card'
import { PageHeader } from '#/components/admin/PageHeader'
import { DateRangePicker } from '#/components/admin/DateRangePicker'
import { FilterDropdown } from '#/components/admin/FilterDropdown'
import { inputClassName } from '#/components/admin/ui'

const BRAND_OPTIONS = STOREFRONT_BRANDS.map((brand) => ({
  value: brand,
  label: STOREFRONT_BRAND_LABELS[brand],
}))

// Same report-viewing timezone toggle as the Profit page (see
// routes/admin/analytics/profit.tsx) — re-buckets the order/sales side of
// these totals by LA vs PH calendar days. Ad spend itself always comes
// back bucketed by whatever timezone the Meta ad account is configured
// to report in, which this toggle has no control over.
const REPORT_TIMEZONE_IANA = {
  ph: 'Asia/Manila',
  la: 'America/Los_Angeles',
} as const

const REPORT_TIMEZONE_NAMES = {
  ph: 'Philippine Time',
  la: 'Los Angeles, America',
} as const

function reportTimezoneOffsetLabel(tz: 'ph' | 'la'): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: REPORT_TIMEZONE_IANA[tz],
    timeZoneName: 'shortOffset',
  }).formatToParts(new Date())
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
}

export const Route = createFileRoute('/admin/analytics/ads-efficiency')({
  validateSearch: z.object({
    range: z.enum(DATE_RANGE_PRESETS).catch('this_month'),
    from: z.string().optional(),
    to: z.string().optional(),
    brand: z.enum(STOREFRONT_BRANDS).optional(),
    // Defaults to LA, unlike the Profit page's 'ph' default — requested
    // specifically for this page.
    tz: z.enum(['ph', 'la']).catch('la'),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const resolved = resolveDateRange(deps.range, {
      from: deps.from,
      to: deps.to,
    })
    return getAdsEfficiency({
      data: {
        ...resolved,
        brand: deps.brand,
        comparePrevious: true,
        tz: deps.tz,
      },
    })
  },
  component: AdsEfficiencyPage,
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

function MetricCard({
  label,
  value,
  trend,
}: {
  label: string
  value: string
  trend: number | null
}) {
  return (
    <Card className="p-5">
      <p className="text-sm font-medium text-neutral-500">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className="text-2xl font-semibold text-neutral-900">{value}</p>
        <TrendTag value={trend} />
      </div>
    </Card>
  )
}

function TotalsGrid({
  totals,
  previous,
}: {
  totals: AdsEfficiencyTotals
  previous: AdsEfficiencyTotals | null
}) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <MetricCard
        label="Ads spend"
        value={formatCentsAsPHP(totals.adsSpendCents)}
        trend={
          previous
            ? percentChange(totals.adsSpendCents, previous.adsSpendCents)
            : null
        }
      />
      <MetricCard
        label="Gross sales"
        value={formatCentsAsPHP(totals.grossSalesCents)}
        trend={
          previous
            ? percentChange(totals.grossSalesCents, previous.grossSalesCents)
            : null
        }
      />
      <MetricCard
        label="Orders"
        value={String(totals.orderCount)}
        trend={
          previous
            ? percentChange(totals.orderCount, previous.orderCount)
            : null
        }
      />
      <MetricCard
        label="ROAS"
        value={totals.roas === null ? '—' : `${totals.roas.toFixed(2)}x`}
        trend={
          previous && totals.roas !== null && previous.roas !== null
            ? percentChange(totals.roas, previous.roas)
            : null
        }
      />
      <MetricCard
        label="Cost per purchase"
        value={
          totals.costPerPurchaseCents === null
            ? '—'
            : formatCentsAsPHP(totals.costPerPurchaseCents)
        }
        trend={
          previous &&
          totals.costPerPurchaseCents !== null &&
          previous.costPerPurchaseCents !== null
            ? percentChange(
                totals.costPerPurchaseCents,
                previous.costPerPurchaseCents,
              )
            : null
        }
      />
    </div>
  )
}

function AdsEfficiencyPage() {
  const data = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  function handleRangeChange(
    preset: (typeof DATE_RANGE_PRESETS)[number],
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

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Ads Efficiency"
        subtitle="ROAS and cost per purchase for Meta ad spend."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <FilterDropdown
              label="Brand"
              value={search.brand}
              options={BRAND_OPTIONS}
              onChange={(brand) =>
                navigate({ search: (prev) => ({ ...prev, brand }) })
              }
            />
            <DateRangePicker
              preset={search.range}
              from={data.range.from}
              to={data.range.to}
              onChange={handleRangeChange}
            />
            <select
              value={search.tz}
              onChange={(e) =>
                navigate({
                  search: (prev) => ({
                    ...prev,
                    tz: e.target.value as 'ph' | 'la',
                  }),
                })
              }
              className={inputClassName}
              title="Timezone the order/sales totals are grouped by"
            >
              {(Object.keys(REPORT_TIMEZONE_NAMES) as ('ph' | 'la')[]).map(
                (tz) => (
                  <option key={tz} value={tz}>
                    {REPORT_TIMEZONE_NAMES[tz]} ({reportTimezoneOffsetLabel(tz)}
                    )
                  </option>
                ),
              )}
            </select>
          </div>
        }
      />

      <div className="mt-5">
        <h2 className="text-sm font-semibold text-neutral-900">
          Whole store, every channel
        </h2>
        <p className="text-xs text-neutral-500">
          Total ad spend against total gross sales and orders across
          Storefront, TikTok Shop, Shopee, and Lazada — not a claim that
          these specific orders came from an ad, just how the whole store is
          doing relative to what was spent on ads.
        </p>
        <div className="mt-3">
          <TotalsGrid totals={data.totals} previous={data.previousTotals} />
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-900">
          Facebook-ad-attributed orders only
        </h2>
        <p className="text-xs text-neutral-500">
          Storefront orders that can be traced back to a Facebook ad click
          (first-click attribution) — a narrower but more literal "did this
          ad spend actually work" figure. Excludes TikTok Shop, Shopee,
          Lazada, and any storefront order without a captured ad click.
        </p>
        <div className="mt-3">
          <TotalsGrid
            totals={data.attributedTotals}
            previous={data.previousAttributedTotals}
          />
        </div>
      </div>
    </div>
  )
}

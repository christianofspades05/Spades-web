import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { getTikTokFinanceSummary } from '#/server/admin/tiktok-finance'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { DATE_RANGE_PRESETS, resolveDateRange } from '#/lib/utils/date-range'
import { Card } from '#/components/admin/Card'
import { PageHeader } from '#/components/admin/PageHeader'
import { DateRangePicker } from '#/components/admin/DateRangePicker'
import {
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

export const Route = createFileRoute('/admin/analytics/tiktok-finance')({
  validateSearch: z.object({
    range: z.enum(DATE_RANGE_PRESETS).catch('last_30_days'),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const resolved = resolveDateRange(deps.range, {
      from: deps.from,
      to: deps.to,
    })
    return getTikTokFinanceSummary({ data: resolved })
  },
  component: TikTokFinancePage,
})

function SummaryCard({
  label,
  cents,
  tone,
}: {
  label: string
  cents: number
  tone?: 'default' | 'negative' | 'positive'
}) {
  const color =
    tone === 'negative'
      ? 'text-red-600'
      : tone === 'positive'
        ? 'text-emerald-600'
        : 'text-neutral-900'
  return (
    <Card className="p-5">
      <p className="text-sm font-medium text-neutral-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${color}`}>
        {formatCentsAsPHP(cents)}
      </p>
    </Card>
  )
}

function TikTokFinancePage() {
  const summary = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

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
        title="TikTok Finance"
        subtitle="Whole-shop revenue, fees, and settlement — summed from TikTok's own payout statements, not per order."
        action={
          <DateRangePicker
            preset={search.range}
            from={search.from ?? resolveDateRange(search.range, {}).from}
            to={search.to ?? resolveDateRange(search.range, {}).to}
            onChange={handleRangeChange}
          />
        }
      />

      {!summary.connected ? (
        <p className="mt-5 text-sm text-neutral-500">
          TikTok Shop isn't connected — connect it under Channels first.
        </p>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <SummaryCard label="Revenue" cents={summary.totals.revenueCents} />
            <SummaryCard
              label="Fees"
              cents={summary.totals.feeCents}
              tone="negative"
            />
            <SummaryCard
              label="Adjustments"
              cents={summary.totals.adjustmentCents}
              tone="negative"
            />
            <SummaryCard
              label="Settlement"
              cents={summary.totals.settlementCents}
              tone="positive"
            />
            <SummaryCard
              label="Net sales"
              cents={summary.totals.netSalesCents}
            />
            <SummaryCard
              label="Shipping cost"
              cents={summary.totals.shippingCostCents}
            />
          </div>

          <Card className="mt-6 p-5">
            <h2 className="text-sm font-semibold text-neutral-900">
              Payout statements
            </h2>
            <p className="text-xs text-neutral-500">
              One row per TikTok Shop payout cycle in this range — not per
              order.
            </p>

            {summary.statements.length === 0 ? (
              <p className="mt-5 text-sm text-neutral-400">
                No payout statements in this range.
              </p>
            ) : (
              <div className={`${tableWrapperClassName} mt-5`}>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className={tableHeadClassName}>Date</th>
                        <th className={`${tableHeadClassName} text-right`}>
                          Revenue
                        </th>
                        <th className={`${tableHeadClassName} text-right`}>
                          Fees
                        </th>
                        <th className={`${tableHeadClassName} text-right`}>
                          Adjustments
                        </th>
                        <th className={`${tableHeadClassName} text-right`}>
                          Settlement
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.statements.map((s) => (
                        <tr key={s.id} className={tableRowClassName}>
                          <td className={tableCellClassName}>{s.date}</td>
                          <td className={`${tableCellClassName} text-right`}>
                            {formatCentsAsPHP(s.revenueCents)}
                          </td>
                          <td
                            className={`${tableCellClassName} text-right text-red-600`}
                          >
                            {formatCentsAsPHP(s.feeCents)}
                          </td>
                          <td
                            className={`${tableCellClassName} text-right text-red-600`}
                          >
                            {formatCentsAsPHP(s.adjustmentCents)}
                          </td>
                          <td
                            className={`${tableCellClassName} text-right font-medium text-emerald-600`}
                          >
                            {formatCentsAsPHP(s.settlementCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

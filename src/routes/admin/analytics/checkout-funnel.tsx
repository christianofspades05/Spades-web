import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import {
  getCheckoutFunnelSummary,
  getCheckoutShippingDropoff,
} from '#/server/admin/checkout-funnel'
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

export const Route = createFileRoute('/admin/analytics/checkout-funnel')({
  validateSearch: z.object({
    range: z.enum(DATE_RANGE_PRESETS).catch('this_month'),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    // The underlying views group by America/Los_Angeles day (the Meta ad
    // account timezone — see 0127's migration comment), while this
    // picker's presets resolve "today"/"this month"/etc. against the
    // store's own PH time — a one-day skew at the very edges of a range
    // is an acceptable imprecision for this reporting page, same trade-
    // off the Profit page's PH/LA toggle exists to avoid for money
    // figures, which this isn't.
    const resolved = resolveDateRange(deps.range, {
      from: deps.from,
      to: deps.to,
    })
    const [summary, shippingDropoff] = await Promise.all([
      getCheckoutFunnelSummary({ data: resolved }),
      getCheckoutShippingDropoff(),
    ])
    return { summary, shippingDropoff }
  },
  component: CheckoutFunnelPage,
})

function CheckoutFunnelPage() {
  const { summary, shippingDropoff } = Route.useLoaderData()
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

  const maxCount = summary.steps[0]?.count || 1

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Checkout Funnel"
        subtitle="Where shoppers drop off between adding to cart and a placed order — grouped by America/Los Angeles day."
        action={
          <DateRangePicker
            preset={search.range}
            from={search.from ?? resolveDateRange(search.range, {}).from}
            to={search.to ?? resolveDateRange(search.range, {}).to}
            onChange={handleRangeChange}
          />
        }
      />

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="p-5">
          <p className="text-sm font-medium text-neutral-500">
            Checkout started
          </p>
          <p className="mt-2 text-2xl font-semibold text-neutral-900">
            {summary.steps[0]?.count.toLocaleString() ?? 0}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-neutral-500">
            Orders placed/paid
          </p>
          <p className="mt-2 text-2xl font-semibold text-emerald-600">
            {(summary.steps.at(-1)?.count ?? 0).toLocaleString()}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-neutral-500">
            Chose Cash on Delivery
          </p>
          <p className="mt-2 text-2xl font-semibold text-neutral-900">
            {summary.codSelected.toLocaleString()}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-medium text-neutral-500">
            Chose online payment
          </p>
          <p className="mt-2 text-2xl font-semibold text-neutral-900">
            {summary.onlineSelected.toLocaleString()}
          </p>
        </Card>
      </div>

      <Card className="mt-6 p-5">
        <h2 className="text-sm font-semibold text-neutral-900">
          Step-by-step drop-off
        </h2>
        <p className="text-xs text-neutral-500">
          Distinct visitors per step. % is conversion from the step right above
          it.
        </p>
        <div className="mt-5 space-y-3">
          {summary.steps.map((step) => (
            <div key={step.key}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-neutral-900">
                  {step.label}
                </span>
                <span className="text-neutral-600">
                  {step.count.toLocaleString()}
                  {step.conversionFromPrevPct !== null && (
                    <span className="ml-2 text-xs text-neutral-400">
                      ({step.conversionFromPrevPct}% of previous)
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-1 h-2 w-full rounded-full bg-neutral-100">
                <div
                  className="h-2 rounded-full bg-neutral-900"
                  style={{
                    width: `${Math.max(2, (step.count / maxCount) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-6 p-5">
        <h2 className="text-sm font-semibold text-neutral-900">
          Shipping fee shown → placed order, by region
        </h2>
        <p className="text-xs text-neutral-500">
          Whether a non-zero shipping fee is what's making people leave —
          all-time, not scoped to the date range above.
        </p>
        {shippingDropoff.length === 0 ? (
          <p className="mt-5 text-sm text-neutral-400">
            No checkout_shipping_shown events recorded yet.
          </p>
        ) : (
          <div className={`${tableWrapperClassName} mt-5`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={tableHeadClassName}>Region</th>
                    <th className={tableHeadClassName}>Free shipping?</th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Shipping shown
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Placed order
                    </th>
                    <th className={`${tableHeadClassName} text-right`}>
                      Conversion
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shippingDropoff.map((row, index) => (
                    <tr key={index} className={tableRowClassName}>
                      <td className={tableCellClassName}>
                        {row.region ?? '—'}
                      </td>
                      <td className={tableCellClassName}>
                        {row.freeShipping === null
                          ? '—'
                          : row.freeShipping
                            ? 'Free'
                            : 'Paid'}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {row.shippingShownCarts.toLocaleString()}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {row.placeOrderClickedCarts.toLocaleString()}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {row.conversionPct === null
                          ? '—'
                          : `${row.conversionPct}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

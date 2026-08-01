import { createFileRoute, Link } from '@tanstack/react-router'
import { listMarkets } from '#/server/admin/market-pricing'
import { formatCountryName } from '#/lib/utils/countries'
import { PageHeader } from '#/components/admin/PageHeader'
import { Badge } from '#/components/admin/Badge'
import {
  buttonPrimaryClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

export const Route = createFileRoute('/admin/markets/')({
  loader: () => listMarkets(),
  component: MarketsPage,
})

function MarketsPage() {
  const markets = Route.useLoaderData()

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Markets"
        subtitle="Charge more for orders shipping to specific countries — applied to the product subtotal only, never shipping."
        action={
          <Link to="/admin/markets/new" className={buttonPrimaryClassName}>
            Add market
          </Link>
        }
      />

      <div className={tableWrapperClassName}>
        {markets.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">
            No markets yet. Every country is charged the same as the
            Philippines.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClassName}>Countries</th>
                  <th className={tableHeadClassName}>Status</th>
                  <th className={`${tableHeadClassName} text-right`}>Markup</th>
                </tr>
              </thead>
              <tbody>
                {markets.map((market) => (
                  <tr key={market.id} className={tableRowClassName}>
                    <td className={tableCellClassName}>
                      <Link
                        to="/admin/markets/$marketId"
                        params={{ marketId: market.id }}
                        className="font-medium text-neutral-900 hover:underline"
                      >
                        {market.countryCodes
                          .map((code) => formatCountryName(code))
                          .join(', ')}
                      </Link>
                    </td>
                    <td className={tableCellClassName}>
                      <Badge tone={market.is_active ? 'success' : 'neutral'}>
                        {market.is_active ? 'active' : 'inactive'}
                      </Badge>
                    </td>
                    <td
                      className={`${tableCellClassName} text-right text-neutral-500`}
                    >
                      +{market.markup_percent}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

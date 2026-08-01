import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { createMarket, listMarkets } from '#/server/admin/market-pricing'
import { PageHeader } from '#/components/admin/PageHeader'
import { MarketPricingForm } from '#/components/admin/MarketPricingForm'
import type { MarketInput } from '#/lib/validation/admin/market-pricing'

export const Route = createFileRoute('/admin/markets/new')({
  loader: () => listMarkets(),
  component: NewMarketPricingPage,
})

function NewMarketPricingPage() {
  const markets = Route.useLoaderData()
  const navigate = useNavigate()
  const takenCountryCodes = markets.flatMap((m) => m.countryCodes)

  async function handleSubmit(data: MarketInput) {
    const market = await createMarket({ data })
    await navigate({
      to: '/admin/markets/$marketId',
      params: { marketId: market.id },
    })
  }

  return (
    <div className="w-full max-w-2xl px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader title="Add market" />
      <MarketPricingForm
        takenCountryCodes={takenCountryCodes}
        onSubmit={handleSubmit}
        submitLabel="Add market"
      />
    </div>
  )
}

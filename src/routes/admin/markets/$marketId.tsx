import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { listMarkets, updateMarket } from '#/server/admin/market-pricing'
import { formatCountryName } from '#/lib/utils/countries'
import { PageHeader } from '#/components/admin/PageHeader'
import { MarketPricingForm } from '#/components/admin/MarketPricingForm'
import type { MarketInput } from '#/lib/validation/admin/market-pricing'

export const Route = createFileRoute('/admin/markets/$marketId')({
  loader: async ({ params }) => {
    const markets = await listMarkets()
    const market = markets.find((m) => m.id === params.marketId)
    if (!market) throw notFound()
    const takenCountryCodes = markets
      .filter((m) => m.id !== params.marketId)
      .flatMap((m) => m.countryCodes)
    return { market, takenCountryCodes }
  },
  component: EditMarketPricingPage,
})

function EditMarketPricingPage() {
  const { market, takenCountryCodes } = Route.useLoaderData()
  const navigate = useNavigate()

  async function handleSubmit(data: MarketInput) {
    await updateMarket({ data: { ...data, id: market.id } })
    await navigate({ to: '/admin/markets' })
  }

  return (
    <div className="w-full max-w-2xl px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title={`Edit ${market.countryCodes.map((c) => formatCountryName(c)).join(', ')}`}
      />
      <MarketPricingForm
        market={market}
        takenCountryCodes={takenCountryCodes}
        onSubmit={handleSubmit}
        submitLabel="Save changes"
      />
    </div>
  )
}

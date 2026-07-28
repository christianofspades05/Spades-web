import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import {
  getMarketPricingById,
  updateMarketPricing,
} from '#/server/admin/market-pricing'
import { formatCountryName } from '#/lib/utils/countries'
import { PageHeader } from '#/components/admin/PageHeader'
import { MarketPricingForm } from '#/components/admin/MarketPricingForm'
import type { MarketPricingInput } from '#/lib/validation/admin/market-pricing'

export const Route = createFileRoute('/admin/markets/$marketId')({
  loader: async ({ params }) => {
    const market = await getMarketPricingById({ data: { id: params.marketId } })
    if (!market) throw notFound()
    return { market }
  },
  component: EditMarketPricingPage,
})

function EditMarketPricingPage() {
  const { market } = Route.useLoaderData()
  const navigate = useNavigate()

  async function handleSubmit(data: MarketPricingInput) {
    await updateMarketPricing({ data: { ...data, id: market.id } })
    await navigate({ to: '/admin/markets' })
  }

  return (
    <div className="w-full max-w-2xl px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader title={`Edit ${formatCountryName(market.country_code)}`} />
      <MarketPricingForm
        market={market}
        onSubmit={handleSubmit}
        submitLabel="Save changes"
      />
    </div>
  )
}

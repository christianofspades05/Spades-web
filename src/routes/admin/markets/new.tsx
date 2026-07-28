import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { createMarketPricing } from '#/server/admin/market-pricing'
import { PageHeader } from '#/components/admin/PageHeader'
import { MarketPricingForm } from '#/components/admin/MarketPricingForm'
import type { MarketPricingInput } from '#/lib/validation/admin/market-pricing'

export const Route = createFileRoute('/admin/markets/new')({
  component: NewMarketPricingPage,
})

function NewMarketPricingPage() {
  const navigate = useNavigate()

  async function handleSubmit(data: MarketPricingInput) {
    const market = await createMarketPricing({ data })
    await navigate({
      to: '/admin/markets/$marketId',
      params: { marketId: market.id },
    })
  }

  return (
    <div className="w-full max-w-2xl px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader title="Add market" />
      <MarketPricingForm onSubmit={handleSubmit} submitLabel="Add market" />
    </div>
  )
}

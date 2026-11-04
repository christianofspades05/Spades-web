import { createFileRoute, Outlet } from '@tanstack/react-router'
import { CheckoutProvider } from '#/lib/checkout/CheckoutContext'
import { getActiveMarketMarkups } from '#/server/storefront/market-pricing'

export const Route = createFileRoute('/checkout')({
  // Cached server-side (see getActiveMarketMarkups/invalidateMarketConfigCache)
  // — calling it again here as well as in checkout/index.tsx's own loader
  // is a cheap cache hit, not a second real query. Needed up here (not just
  // down there) so the geo-country default below knows which countries are
  // actually configured markets.
  loader: () => getActiveMarketMarkups(),
  component: CheckoutLayout,
})

function CheckoutLayout() {
  const { geoCountry } = Route.useRouteContext()
  const marketMarkups = Route.useLoaderData()
  const knownMarketCountries = ['PH', ...Object.keys(marketMarkups)]

  return (
    <CheckoutProvider
      geoCountry={geoCountry}
      knownMarketCountries={knownMarketCountries}
    >
      <Outlet />
    </CheckoutProvider>
  )
}

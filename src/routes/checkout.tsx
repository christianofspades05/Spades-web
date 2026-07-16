import { createFileRoute, Outlet } from '@tanstack/react-router'
import { CheckoutProvider } from '#/lib/checkout/CheckoutContext'

export const Route = createFileRoute('/checkout')({
  component: CheckoutLayout,
})

function CheckoutLayout() {
  return (
    <CheckoutProvider>
      <Outlet />
    </CheckoutProvider>
  )
}

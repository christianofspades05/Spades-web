import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/checkout/')({ component: CheckoutPage })

function CheckoutPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-bold">Checkout</h1>
      <p className="mt-4 text-neutral-600">
        Checkout (address, shipping, COD eligibility, payments) is
        intentionally not built yet — see{' '}
        <code>src/server/checkout/README.md</code> for the planned design.
      </p>
    </div>
  )
}

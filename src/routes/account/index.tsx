import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/account/')({ component: AccountPage })

function AccountPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-bold">Account</h1>
      <p className="mt-4 text-neutral-600">
        Customer accounts (sign in, order history, address book) are built on
        top of this route in a later step.
      </p>
    </div>
  )
}

import { createFileRoute } from '@tanstack/react-router'
import { unsubscribeByToken } from '#/server/marketing/unsubscribe'

export const Route = createFileRoute('/unsubscribe/$token')({
  loader: async ({ params }) =>
    unsubscribeByToken({ data: { token: params.token } }),
  component: UnsubscribePage,
})

function UnsubscribePage() {
  const { email } = Route.useLoaderData()

  if (!email) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">This link isn't valid</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          It may have expired or already been used.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-24 text-center">
      <h1 className="text-2xl font-bold">You're unsubscribed</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        {email} won't receive any more cart reminder emails from Spades.
      </p>
    </div>
  )
}

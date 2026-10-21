import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { listUpcomingEvents } from '#/server/events/queries'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { STOREFRONT_CACHE_HEADERS } from '#/lib/utils/cache-control'

export const Route = createFileRoute('/events/')({
  headers: () => STOREFRONT_CACHE_HEADERS,
  loader: async ({ context }) => {
    // Community Events is a Spades-only feature — Ysrael/Aspire365 never
    // show this nav link (see Header.tsx), and a direct hit on the URL
    // 404s the same way any other out-of-scope route would.
    if (context.storefrontScope.brand !== 'spades') throw notFound()
    const events = await listUpcomingEvents()
    return { events }
  },
  component: EventsPage,
})

function EventsPage() {
  const { events } = Route.useLoaderData()

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-3xl font-semibold text-neutral-900 dark:text-neutral-50">
        Community Events
      </h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        Upcoming Spades community events — reserve your slot below.
      </p>

      {events.length === 0 ? (
        <p className="mt-10 text-neutral-500">
          No upcoming events right now — check back soon.
        </p>
      ) : (
        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {events.map((event) => {
            const soldOut = event.slots_reserved >= event.total_slots
            return (
              <Link
                key={event.id}
                to="/events/$slug"
                params={{ slug: event.slug }}
                className="group block overflow-hidden rounded-lg border border-neutral-200 transition hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
              >
                {event.image_url ? (
                  <img
                    src={event.image_url}
                    alt=""
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="aspect-square w-full bg-neutral-100 dark:bg-neutral-900" />
                )}
                <div className="p-4">
                  <p className="font-medium text-neutral-900 group-hover:underline dark:text-neutral-50">
                    {event.name}
                  </p>
                  <p className="mt-1 text-sm text-neutral-500">
                    {new Date(event.starts_at).toLocaleString('en-US', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: 'Asia/Manila',
                    })}
                    {' – '}
                    {new Date(event.ends_at).toLocaleTimeString('en-US', {
                      timeStyle: 'short',
                      timeZone: 'Asia/Manila',
                    })}
                  </p>
                  <p className="text-sm text-neutral-500">
                    {event.location_name}
                  </p>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="font-medium text-neutral-900 dark:text-neutral-50">
                      {event.fee_cents === 0
                        ? 'Free'
                        : formatCentsAsPHP(event.fee_cents)}
                    </span>
                    <span
                      className={
                        soldOut
                          ? 'text-red-600'
                          : 'text-neutral-500 dark:text-neutral-400'
                      }
                    >
                      {soldOut
                        ? 'Fully booked'
                        : `${event.total_slots - event.slots_reserved} slots left`}
                    </span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

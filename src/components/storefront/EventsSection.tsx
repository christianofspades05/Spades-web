import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { optimizedImageUrl } from '#/lib/utils/image-optimize'
import type { HomepageEvent } from '#/server/events/queries'

// Event poster thumbnails are ~1/3 of a phone screen and under 200px on
// desktop, so 384 covers 2x density. One of vercel.json's images.sizes.
const EVENT_IMAGE_WIDTH = 384

function formatEventTime(event: HomepageEvent): string {
  const start = new Date(event.starts_at).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  })
  const end = new Date(event.ends_at).toLocaleTimeString('en-US', {
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  })
  return `${start} – ${end}`
}

/**
 * Spades-only homepage "JOIN EVENT" block: community events that haven't
 * ended yet (up to 4), each card linking to the Events page.
 */
export function EventsSection({ events }: { events: HomepageEvent[] }) {
  // The homepage HTML is CDN-cached, so "has it started yet" is decided in
  // the browser after hydration rather than baked into the cached copy.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => setNow(Date.now()), [])
  return (
    <section className="bg-neutral-950 py-10 text-white sm:py-14">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="mb-5 flex items-end justify-between gap-3">
          <h2 className="text-xl font-black uppercase tracking-tight sm:text-2xl">
            Join Event
          </h2>
          <Link
            to="/events"
            className="flex items-center gap-0.5 text-xs font-semibold uppercase tracking-wider text-neutral-400 hover:text-white"
          >
            All events
            <ChevronRight size={14} />
          </Link>
        </div>

        <div
          className={`grid grid-cols-1 gap-4 ${events.length > 1 ? 'lg:grid-cols-2' : ''}`}
        >
          {events.map((event) => {
            const slotsLeft = Math.max(
              0,
              event.total_slots - event.slots_reserved,
            )
            const happeningNow =
              now !== null && new Date(event.starts_at).getTime() <= now
            return (
              <Link
                key={event.id}
                to="/events"
                className="group flex overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 transition hover:border-neutral-600"
              >
                {event.image_url ? (
                  <img
                    src={optimizedImageUrl(event.image_url, EVENT_IMAGE_WIDTH)}
                    alt=""
                    loading="lazy"
                    className="aspect-square w-28 shrink-0 object-cover sm:w-44"
                  />
                ) : (
                  <div className="aspect-square w-28 shrink-0 bg-neutral-800 sm:w-44" />
                )}
                <div className="flex min-w-0 flex-1 flex-col p-3 sm:p-4">
                  {happeningNow && (
                    <span className="mb-1 w-fit rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                      Happening now
                    </span>
                  )}
                  <p className="font-bold uppercase leading-tight group-hover:underline sm:text-lg">
                    {event.name}
                  </p>
                  <p className="mt-1 text-xs text-neutral-400 sm:text-sm">
                    {formatEventTime(event)}
                  </p>
                  <p className="text-xs text-neutral-400 sm:text-sm">
                    {event.location_name}
                  </p>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-sm">
                    <span className="font-semibold">
                      {event.fee_cents === 0
                        ? 'Free'
                        : formatCentsAsPHP(event.fee_cents)}
                    </span>
                    <span
                      className={
                        slotsLeft === 0 ? 'text-red-500' : 'text-neutral-400'
                      }
                    >
                      {slotsLeft === 0
                        ? 'Fully booked'
                        : `${slotsLeft} ${slotsLeft === 1 ? 'slot' : 'slots'} left`}
                    </span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}

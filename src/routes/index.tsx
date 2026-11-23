import { Fragment } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { loadStorefrontSections } from '#/server/storefront/sections'
import { loadCommunityFits } from '#/server/storefront/community-fits'
import { listOngoingEvents } from '#/server/events/queries'
import { SectionBlock } from '#/components/storefront/SectionBlock'
import { CommunityFitsSection } from '#/components/storefront/CommunityFitsSection'
import { EventsSection } from '#/components/storefront/EventsSection'
import { STOREFRONT_CACHE_HEADERS } from '#/lib/utils/cache-control'
import { communityFitsInsertIndex } from '#/lib/storefront/community-fits-placement'
import { eventsInsertIndex } from '#/lib/storefront/events-placement'

export const Route = createFileRoute('/')({
  headers: () => STOREFRONT_CACHE_HEADERS,
  loader: async ({ context }) => {
    const brand = context.storefrontScope.brand
    const [sections, communityFits, events] = await Promise.all([
      loadStorefrontSections({ data: { page: 'home', brand } }),
      // Community Fits and events are Spades-only sections — Ysrael/Aspire
      // 365 never load or show them.
      brand === 'spades' ? loadCommunityFits() : Promise.resolve([]),
      brand === 'spades' ? listOngoingEvents() : Promise.resolve([]),
    ])
    return { sections, communityFits, events }
  },
  component: Home,
})

function Home() {
  const { sections, communityFits, events } = Route.useLoaderData()
  const fitsIndex =
    communityFits.length > 0 ? communityFitsInsertIndex(sections) : -1
  const eventsIndex = events.length > 0 ? eventsInsertIndex(sections) : -1

  return (
    <div className="bg-white dark:bg-neutral-950">
      {sections.map((section, index) => (
        <Fragment key={section.id}>
          {index === eventsIndex && <EventsSection events={events} />}
          {index === fitsIndex && <CommunityFitsSection fits={communityFits} />}
          <SectionBlock section={section} />
        </Fragment>
      ))}
      {eventsIndex === sections.length && <EventsSection events={events} />}
      {fitsIndex === sections.length && (
        <CommunityFitsSection fits={communityFits} />
      )}
    </div>
  )
}

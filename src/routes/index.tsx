import { Fragment } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { loadStorefrontSections } from '#/server/storefront/sections'
import { loadCommunityFits } from '#/server/storefront/community-fits'
import { SectionBlock } from '#/components/storefront/SectionBlock'
import { CommunityFitsSection } from '#/components/storefront/CommunityFitsSection'
import { STOREFRONT_CACHE_HEADERS } from '#/lib/utils/cache-control'
import { communityFitsInsertIndex } from '#/lib/storefront/community-fits-placement'

export const Route = createFileRoute('/')({
  headers: () => STOREFRONT_CACHE_HEADERS,
  loader: async ({ context }) => {
    const brand = context.storefrontScope.brand
    const [sections, communityFits] = await Promise.all([
      loadStorefrontSections({ data: { page: 'home', brand } }),
      // Community Fits is a Spades-only section — Ysrael/Aspire 365 never
      // load or show it.
      brand === 'spades' ? loadCommunityFits() : Promise.resolve([]),
    ])
    return { sections, communityFits }
  },
  component: Home,
})

function Home() {
  const { sections, communityFits } = Route.useLoaderData()
  const fitsIndex =
    communityFits.length > 0 ? communityFitsInsertIndex(sections) : -1

  return (
    <div className="bg-white dark:bg-neutral-950">
      {sections.map((section, index) => (
        <Fragment key={section.id}>
          {index === fitsIndex && <CommunityFitsSection fits={communityFits} />}
          <SectionBlock section={section} />
        </Fragment>
      ))}
      {fitsIndex === sections.length && (
        <CommunityFitsSection fits={communityFits} />
      )}
    </div>
  )
}

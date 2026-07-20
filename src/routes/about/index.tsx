import { createFileRoute } from '@tanstack/react-router'
import { loadStorefrontSections } from '#/server/storefront/sections'
import { SectionBlock } from '#/components/storefront/SectionBlock'
import { STATIC_CACHE_HEADERS } from '#/lib/utils/cache-control'

export const Route = createFileRoute('/about/')({
  headers: () => STATIC_CACHE_HEADERS,
  loader: async () => {
    const sections = await loadStorefrontSections({ data: { page: 'about' } })
    return { sections }
  },
  component: AboutPage,
})

function AboutPage() {
  const { sections } = Route.useLoaderData()

  return (
    <div className="bg-neutral-950 text-white">
      {sections.map((section) => (
        <SectionBlock key={section.id} section={section} />
      ))}
    </div>
  )
}

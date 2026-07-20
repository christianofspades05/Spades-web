import { createFileRoute } from '@tanstack/react-router'
import { loadStorefrontSections } from '#/server/storefront/sections'
import { SectionBlock } from '#/components/storefront/SectionBlock'
import { STOREFRONT_CACHE_HEADERS } from '#/lib/utils/cache-control'

export const Route = createFileRoute('/')({
  headers: () => STOREFRONT_CACHE_HEADERS,
  loader: async () => {
    const sections = await loadStorefrontSections({ data: { page: 'home' } })
    return { sections }
  },
  component: Home,
})

function Home() {
  const { sections } = Route.useLoaderData()

  return (
    <div className="bg-white dark:bg-neutral-950">
      {sections.map((section) => (
        <SectionBlock key={section.id} section={section} />
      ))}
    </div>
  )
}

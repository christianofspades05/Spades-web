import { createFileRoute } from '@tanstack/react-router'
import { loadStorefrontCollectionSections } from '#/server/collections/sections'
import { CollectionSections } from '#/components/storefront/CollectionSections'
import { STOREFRONT_CACHE_HEADERS } from '#/lib/utils/cache-control'

export const Route = createFileRoute('/collections/')({
  headers: () => STOREFRONT_CACHE_HEADERS,
  loader: async () => {
    const sections = await loadStorefrontCollectionSections()
    return { sections }
  },
  component: CollectionsPage,
})

function CollectionsPage() {
  const { sections } = Route.useLoaderData()

  return (
    <div className="mx-auto max-w-6xl px-6 py-14 sm:py-20">
      <h1 className="mb-12 text-3xl font-black uppercase tracking-tight">
        Collections
      </h1>
      <CollectionSections sections={sections} />
    </div>
  )
}

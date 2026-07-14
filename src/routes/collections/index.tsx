import { createFileRoute } from '@tanstack/react-router'
import { listActiveCollections } from '#/server/collections/queries'

export const Route = createFileRoute('/collections/')({
  loader: () => listActiveCollections(),
  component: CollectionsPage,
})

function CollectionsPage() {
  const collections = Route.useLoaderData()

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <h1 className="mb-8 text-3xl font-bold">Collections</h1>
      {collections.length === 0 ? (
        <p className="text-neutral-500">No collections yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {collections.map((collection) => (
            <li key={collection.id} className="rounded-lg border border-neutral-200 p-4">
              {collection.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

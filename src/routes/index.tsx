import { createFileRoute, Link } from '@tanstack/react-router'
import { listActiveCollections } from '#/server/collections/queries'

export const Route = createFileRoute('/')({
  loader: () => listActiveCollections(),
  component: Home,
})

function Home() {
  const collections = Route.useLoaderData()

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <header className="mb-12">
        <p className="text-sm uppercase tracking-[0.3em] text-neutral-500">
          Philippine Streetwear
        </p>
        <h1 className="mt-2 text-5xl font-black tracking-tight">SPADES</h1>
        <p className="mt-4 max-w-xl text-neutral-600">
          The foundation is live. Collections, products, cart, and checkout are
          built next on top of this scaffold.
        </p>
      </header>

      <section>
        <h2 className="mb-4 text-lg font-semibold">Collections</h2>
        {collections.length === 0 ? (
          <p className="text-neutral-500">
            No collections yet — add some in Supabase to see them here.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {collections.map((collection) => (
              <li key={collection.id}>
                <Link
                  to="/collections"
                  className="block rounded-lg border border-neutral-200 p-4 hover:border-neutral-400"
                >
                  {collection.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  createCollection,
  listAllCollections,
} from '#/server/admin/collections'
import { getErrorMessage } from '#/lib/utils/errors'
import { slugify } from '#/lib/utils/slug'
import { PageHeader } from '#/components/admin/PageHeader'
import { Card } from '#/components/admin/Card'
import { Badge } from '#/components/admin/Badge'
import {
  buttonPrimaryClassName,
  inputClassName,
  labelClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

export const Route = createFileRoute('/admin/collections/')({
  loader: () => listAllCollections(),
  component: CollectionsPage,
})

function CollectionsPage() {
  const collections = Route.useLoaderData()
  const navigate = useNavigate()

  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function handleNameChange(value: string) {
    setName(value)
    if (!slugTouched) setSlug(slugify(value))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      const collection = await createCollection({
        data: { slug, name, isActive: true, sortOrder: collections.length },
      })
      await navigate({
        to: '/admin/collections/$collectionId',
        params: { collectionId: collection.id },
      })
    } catch (err) {
      setError(getErrorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Collections"
        subtitle={`${collections.length} ${collections.length === 1 ? 'collection' : 'collections'}`}
      />

      <div className={tableWrapperClassName}>
        {collections.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">No collections yet.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className={tableHeadClassName}>Name</th>
                <th className={tableHeadClassName}>Slug</th>
                <th className={tableHeadClassName}>Status</th>
                <th className={tableHeadClassName} />
              </tr>
            </thead>
            <tbody>
              {collections.map((collection) => (
                <tr key={collection.id} className={tableRowClassName}>
                  <td className={`${tableCellClassName} font-medium`}>
                    {collection.name}
                  </td>
                  <td className={`${tableCellClassName} text-neutral-500`}>
                    /{collection.slug}
                  </td>
                  <td className={tableCellClassName}>
                    <Badge tone={collection.is_active ? 'success' : 'neutral'}>
                      {collection.is_active ? 'active' : 'inactive'}
                    </Badge>
                  </td>
                  <td className={`${tableCellClassName} text-right`}>
                    <Link
                      to="/admin/collections/$collectionId"
                      params={{ collectionId: collection.id }}
                      className="font-medium text-neutral-600 hover:text-neutral-950 hover:underline"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 className="mt-10 mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        New collection
      </h2>
      <Card className="p-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className={labelClassName}>
            Name
            <input
              required
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              className={inputClassName}
            />
          </label>
          <label className={labelClassName}>
            Slug
            <input
              required
              value={slug}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(e.target.value)
              }}
              placeholder="e.g. summer-drop"
              className={inputClassName}
            />
            <span className="text-xs font-normal text-neutral-500">
              The URL part for this collection — /collections/{slug || '…'}.
              Auto-filled from the name; lowercase letters, numbers, and hyphens
              only.
            </span>
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className={buttonPrimaryClassName}
          >
            {submitting ? 'Creating…' : 'Create collection'}
          </button>
        </form>
      </Card>
      <p className="mt-3 text-xs text-neutral-500">
        After creating, add products manually and/or set up auto-match
        conditions on the collection's edit page — both work together.
      </p>
    </div>
  )
}

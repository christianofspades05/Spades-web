import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import {
  createStorefrontSection,
  createStorefrontSectionUploadUrl,
  deleteStorefrontSection,
  listAllStorefrontSections,
  reorderStorefrontSections,
  setStorefrontSectionActive,
  updateStorefrontSection,
} from '#/server/admin/storefront-sections'
import type { StorefrontSectionWithCollection } from '#/server/admin/storefront-sections'
import { listAllCollections } from '#/server/admin/collections'
import {
  STOREFRONT_PAGES,
  STOREFRONT_PAGE_LABELS,
  STOREFRONT_SECTION_TYPES,
  STOREFRONT_SECTION_TYPE_LABELS,
} from '#/lib/validation/admin/storefront-sections'
import type { StorefrontSectionInput } from '#/lib/validation/admin/storefront-sections'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { getErrorMessage } from '#/lib/utils/errors'
import { PageHeader } from '#/components/admin/PageHeader'
import { Card } from '#/components/admin/Card'
import { Badge } from '#/components/admin/Badge'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/admin/ui'
import type {
  Collection,
  StorefrontPage,
  StorefrontSectionType,
} from '#/types/entities'

export const Route = createFileRoute('/admin/storefront/')({
  validateSearch: z.object({
    page: z.enum(STOREFRONT_PAGES).default('home'),
  }),
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: async ({ deps }) => {
    const [sections, collections] = await Promise.all([
      listAllStorefrontSections({ data: { page: deps.page } }),
      listAllCollections(),
    ])
    return { sections, collections }
  },
  component: StorefrontSectionsPage,
})

function StorefrontSectionsPage() {
  const { sections, collections } = Route.useLoaderData()
  const { page } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()

  const [order, setOrder] = useState(sections.map((s) => s.id))
  useEffect(() => {
    setOrder(sections.map((s) => s.id))
  }, [sections])

  const [addingType, setAddingType] = useState<StorefrontSectionType | null>(
    null,
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const dragIndex = useRef<number | null>(null)
  const [reordering, setReordering] = useState(false)

  const byId = new Map(sections.map((s) => [s.id, s]))
  const orderedSections = order
    .map((id) => byId.get(id))
    .filter((s): s is StorefrontSectionWithCollection => s != null)

  function refresh() {
    router.invalidate()
  }

  async function persistOrder(newOrder: string[]) {
    setOrder(newOrder)
    setReordering(true)
    try {
      await reorderStorefrontSections({ data: { orderedIds: newOrder } })
    } finally {
      setReordering(false)
      refresh()
    }
  }

  function handleDragStart(index: number) {
    dragIndex.current = index
  }

  function handleDragOver(event: React.DragEvent, overIndex: number) {
    event.preventDefault()
    const from = dragIndex.current
    if (from === null || from === overIndex) return
    const next = [...order]
    const [moved] = next.splice(from, 1)
    next.splice(overIndex, 0, moved)
    dragIndex.current = overIndex
    setOrder(next)
  }

  function handleDragEnd() {
    if (dragIndex.current !== null) {
      void persistOrder(order)
    }
    dragIndex.current = null
  }

  async function toggleActive(section: StorefrontSectionWithCollection) {
    await setStorefrontSectionActive({
      data: { id: section.id, isActive: !section.is_active },
    })
    refresh()
  }

  async function handleDelete(section: StorefrontSectionWithCollection) {
    if (!confirm('Delete this section? This can\'t be undone.')) return
    await deleteStorefrontSection({ data: { id: section.id } })
    refresh()
  }

  return (
    <div className="w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Storefront"
        subtitle="Edit your pages — drag to reorder, click a section to edit it."
      />

      <div className="mb-6 flex gap-1 border-b border-neutral-200">
        {STOREFRONT_PAGES.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() =>
              navigate({ search: (prev) => ({ ...prev, page: p }) })
            }
            className={`border-b-2 px-3 pb-2 text-sm font-medium ${
              page === p
                ? 'border-neutral-900 text-neutral-900'
                : 'border-transparent text-neutral-500 hover:text-neutral-900'
            }`}
          >
            {STOREFRONT_PAGE_LABELS[p]}
          </button>
        ))}
      </div>

      {orderedSections.length === 0 && !addingType && (
        <Card className="p-6 text-sm text-neutral-500">
          No sections yet — add one below to start building this page.
        </Card>
      )}

      <div className="flex flex-col gap-2">
        {orderedSections.map((section, index) =>
          editingId === section.id ? (
            <SectionForm
              key={section.id}
              page={page}
              collections={collections}
              initial={section}
              onCancel={() => setEditingId(null)}
              onSaved={() => {
                setEditingId(null)
                refresh()
              }}
            />
          ) : (
            <SectionRow
              key={section.id}
              section={section}
              draggable={!reordering}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              onEdit={() => setEditingId(section.id)}
              onToggleActive={() => toggleActive(section)}
              onDelete={() => handleDelete(section)}
            />
          ),
        )}
      </div>

      {addingType ? (
        <div className="mt-4">
          <SectionForm
            page={page}
            collections={collections}
            initialType={addingType}
            onCancel={() => setAddingType(null)}
            onSaved={() => {
              setAddingType(null)
              refresh()
            }}
          />
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {STOREFRONT_SECTION_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setAddingType(type)}
              className={`${buttonSecondaryClassName} inline-flex items-center gap-1.5`}
            >
              <Plus size={14} />
              {STOREFRONT_SECTION_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SectionRow({
  section,
  draggable,
  onDragStart,
  onDragOver,
  onDragEnd,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  section: StorefrontSectionWithCollection
  draggable: boolean
  onDragStart: () => void
  onDragOver: (event: React.DragEvent) => void
  onDragEnd: () => void
  onEdit: () => void
  onToggleActive: () => void
  onDelete: () => void
}) {
  const summary =
    section.type === 'product_grid'
      ? (section.collection?.name ?? 'No collection selected')
      : (section.title ?? section.media_url ?? '(empty)')

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={`flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <GripVertical size={16} className="shrink-0 text-neutral-300" />
      {section.media_url && (
        <div className="h-10 w-14 shrink-0 overflow-hidden rounded bg-neutral-100">
          {section.type === 'video' ? (
            <video src={section.media_url} className="h-full w-full object-cover" muted />
          ) : (
            <img
              src={section.media_url}
              alt=""
              className="h-full w-full object-cover"
            />
          )}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-neutral-900">
          {STOREFRONT_SECTION_TYPE_LABELS[section.type]}
        </p>
        <p className="truncate text-xs text-neutral-500">{summary}</p>
      </div>
      <Badge tone={section.is_active ? 'success' : 'neutral'}>
        {section.is_active ? 'Visible' : 'Hidden'}
      </Badge>
      <button
        type="button"
        onClick={onToggleActive}
        className={buttonSecondaryClassName}
      >
        {section.is_active ? 'Hide' : 'Show'}
      </button>
      <button type="button" onClick={onEdit} className={buttonSecondaryClassName}>
        Edit
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="rounded-md p-2 text-neutral-400 hover:bg-red-50 hover:text-red-600"
        aria-label="Delete section"
      >
        <Trash2 size={16} />
      </button>
    </div>
  )
}

function SectionForm({
  page,
  collections,
  initial,
  initialType,
  onCancel,
  onSaved,
}: {
  page: StorefrontPage
  collections: Collection[]
  initial?: StorefrontSectionWithCollection
  initialType?: StorefrontSectionType
  onCancel: () => void
  onSaved: () => void
}) {
  const type = initial?.type ?? initialType!
  const [title, setTitle] = useState(initial?.title ?? '')
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? '')
  const [mediaUrl, setMediaUrl] = useState(initial?.media_url ?? '')
  const [linkUrl, setLinkUrl] = useState(initial?.link_url ?? '')
  const [collectionId, setCollectionId] = useState(
    initial?.collection_id ?? '',
  )
  const [isActive, setIsActive] = useState(initial?.is_active ?? true)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const needsMedia = type === 'hero' || type === 'image' || type === 'video'

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const { path, token, publicUrl } = await createStorefrontSectionUploadUrl(
        { data: { fileName: file.name } },
      )
      const { error: uploadError } = await getSupabaseBrowserClient()
        .storage.from('storefront-sections')
        .uploadToSignedUrl(path, token, file)
      if (uploadError) throw uploadError
      setMediaUrl(publicUrl)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    const input: StorefrontSectionInput = {
      type,
      page,
      title: title || undefined,
      subtitle: subtitle || undefined,
      mediaUrl: mediaUrl || undefined,
      linkUrl: linkUrl || undefined,
      collectionId: collectionId || undefined,
      isActive,
    }
    try {
      if (initial) {
        await updateStorefrontSection({ data: { ...input, id: initial.id } })
      } else {
        await createStorefrontSection({ data: input })
      }
      onSaved()
    } catch (err) {
      setError(getErrorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="text-sm font-semibold text-neutral-900">
          {initial ? 'Edit' : 'Add'} {STOREFRONT_SECTION_TYPE_LABELS[type]}
        </p>

        {needsMedia && (
          <label className={labelClassName}>
            {type === 'video' ? 'Video' : 'Image'}
            <input
              type="file"
              accept={type === 'video' ? 'video/*' : 'image/*'}
              onChange={handleFileSelect}
              className={inputClassName}
            />
            {uploading && (
              <span className="text-xs font-normal text-neutral-500">
                Uploading…
              </span>
            )}
            {mediaUrl &&
              (type === 'video' ? (
                <video
                  src={mediaUrl}
                  className="mt-2 h-32 w-full rounded object-cover"
                  muted
                  controls
                />
              ) : (
                <img
                  src={mediaUrl}
                  alt=""
                  className="mt-2 h-32 w-full rounded object-cover"
                />
              ))}
          </label>
        )}

        {(type === 'tagline' || type === 'product_grid') && (
          <label className={labelClassName}>
            {type === 'tagline' ? 'Heading' : 'Heading (optional)'}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClassName}
            />
          </label>
        )}

        {type === 'tagline' && (
          <label className={labelClassName}>
            Body text
            <textarea
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              rows={3}
              className={inputClassName}
            />
          </label>
        )}

        {type === 'product_grid' && (
          <label className={labelClassName}>
            Collection
            <select
              value={collectionId}
              onChange={(e) => setCollectionId(e.target.value)}
              className={inputClassName}
            >
              <option value="">Select a collection…</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {(type === 'hero' || type === 'image' || type === 'product_grid') && (
          <label className={labelClassName}>
            Link {type === 'product_grid' ? '("View all" button, optional)' : '(optional)'}
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="/products or https://…"
              className={inputClassName}
            />
          </label>
        )}

        <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Visible on the homepage
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting || uploading}
            className={buttonPrimaryClassName}
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className={buttonSecondaryClassName}
          >
            Cancel
          </button>
        </div>
      </form>
    </Card>
  )
}

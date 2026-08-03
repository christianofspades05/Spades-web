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
  listMaintenanceMode,
  setMaintenanceMode,
} from '#/server/admin/maintenance'
import type { MaintenanceModeRow } from '#/server/admin/maintenance'
import {
  listStorefrontBanners,
  setStorefrontBanner,
} from '#/server/admin/storefront-banner'
import type { StorefrontBannerRow } from '#/server/admin/storefront-banner'
import { getBrandPreviewUrl } from '#/server/storefront/domain'
import {
  STOREFRONT_BRANDS,
  STOREFRONT_BRAND_LABELS,
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
    brand: z.enum(STOREFRONT_BRANDS).default('spades'),
  }),
  loaderDeps: ({ search }) => ({ page: search.page, brand: search.brand }),
  loader: async ({ deps }) => {
    const [sections, collections, maintenanceMode, banners] =
      await Promise.all([
        listAllStorefrontSections({
          data: { page: deps.page, brand: deps.brand },
        }),
        listAllCollections(),
        listMaintenanceMode(),
        listStorefrontBanners(),
      ])
    return { sections, collections, maintenanceMode, banners }
  },
  component: StorefrontSectionsPage,
})

function StorefrontSectionsPage() {
  const { sections, collections, maintenanceMode, banners } =
    Route.useLoaderData()
  const { page, brand } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()

  const [order, setOrder] = useState(sections.map((s) => s.id))
  useEffect(() => {
    setOrder(sections.map((s) => s.id))
  }, [sections])

  const [maintenance, setMaintenance] =
    useState<MaintenanceModeRow[]>(maintenanceMode)
  const [togglingBrand, setTogglingBrand] = useState<
    (typeof STOREFRONT_BRANDS)[number] | null
  >(null)

  async function toggleMaintenance(row: MaintenanceModeRow) {
    setTogglingBrand(row.brand)
    const nextIsActive = !row.is_active
    try {
      await setMaintenanceMode({
        data: { brand: row.brand, isActive: nextIsActive },
      })
      setMaintenance((prev) =>
        prev.map((r) =>
          r.brand === row.brand ? { ...r, is_active: nextIsActive } : r,
        ),
      )
    } finally {
      setTogglingBrand(null)
    }
  }

  const [bannerRows, setBannerRows] = useState<StorefrontBannerRow[]>(banners)
  const [savingBannerBrand, setSavingBannerBrand] = useState<
    (typeof STOREFRONT_BRANDS)[number] | null
  >(null)

  function updateBannerField(
    forBrand: (typeof STOREFRONT_BRANDS)[number],
    patch: Partial<StorefrontBannerRow>,
  ) {
    setBannerRows((prev) =>
      prev.map((r) => (r.brand === forBrand ? { ...r, ...patch } : r)),
    )
  }

  async function saveBanner(row: StorefrontBannerRow) {
    setSavingBannerBrand(row.brand)
    try {
      await setStorefrontBanner({
        data: { brand: row.brand, text: row.text, isActive: row.is_active },
      })
    } finally {
      setSavingBannerBrand(null)
    }
  }

  const [addingType, setAddingType] = useState<StorefrontSectionType | null>(
    null,
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const dragIndex = useRef<number | null>(null)
  const [reordering, setReordering] = useState(false)
  // Bumped on every save/reorder/etc. to force the preview iframe to reload
  // — an <iframe> has no reason to know the page it's showing just changed
  // otherwise.
  const [previewNonce, setPreviewNonce] = useState(0)

  const byId = new Map(sections.map((s) => [s.id, s]))
  const orderedSections = order
    .map((id) => byId.get(id))
    .filter((s): s is StorefrontSectionWithCollection => s != null)

  function refresh() {
    router.invalidate()
    setPreviewNonce((n) => n + 1)
  }

  const previewUrl = getBrandPreviewUrl(brand, page === 'home' ? '/' : '/about')

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
    if (!confirm("Delete this section? This can't be undone.")) return
    await deleteStorefrontSection({ data: { id: section.id } })
    refresh()
  }

  return (
    <div className="flex w-full gap-6 px-4 py-6 sm:px-8 sm:py-10">
      <div className="w-full max-w-3xl">
        <PageHeader
          title="Storefront"
          subtitle="Edit your pages — drag to reorder, click a section to edit it."
        />

        <Card className="mb-6 p-5">
          <p className="mb-1 text-sm font-semibold text-neutral-900">
            Maintenance mode
          </p>
          <p className="mb-3 text-xs text-neutral-500">
            When on, that brand's storefront shows a "we'll be back soon" page
            instead of the normal site. The admin panel stays usable regardless.
          </p>
          <div className="flex flex-col gap-2">
            {maintenance.map((row) => (
              <div
                key={row.brand}
                className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-neutral-900">
                    {STOREFRONT_BRAND_LABELS[row.brand]}
                  </span>
                  <Badge tone={row.is_active ? 'warning' : 'success'}>
                    {row.is_active ? 'Under maintenance' : 'Live'}
                  </Badge>
                </div>
                <button
                  type="button"
                  disabled={togglingBrand === row.brand}
                  onClick={() => toggleMaintenance(row)}
                  className={buttonSecondaryClassName}
                >
                  {togglingBrand === row.brand
                    ? 'Saving…'
                    : row.is_active
                      ? 'Turn off maintenance'
                      : 'Turn on maintenance'}
                </button>
              </div>
            ))}
          </div>
        </Card>

        <Card className="mb-6 p-5">
          <p className="mb-1 text-sm font-semibold text-neutral-900">
            Top banner
          </p>
          <p className="mb-3 text-xs text-neutral-500">
            The bar at the very top of the storefront, above the header.
            Leave text empty or turn it off to hide it entirely.
          </p>
          <div className="flex flex-col gap-2">
            {bannerRows.map((row) => (
              <div
                key={row.brand}
                className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 sm:flex-row sm:items-center"
              >
                <span className="w-20 shrink-0 text-sm font-medium text-neutral-900">
                  {STOREFRONT_BRAND_LABELS[row.brand]}
                </span>
                <input
                  value={row.text}
                  onChange={(e) =>
                    updateBannerField(row.brand, { text: e.target.value })
                  }
                  placeholder="Banner text…"
                  className={`${inputClassName} flex-1`}
                />
                <div className="flex shrink-0 items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-700">
                    <input
                      type="checkbox"
                      checked={row.is_active}
                      onChange={(e) =>
                        updateBannerField(row.brand, {
                          is_active: e.target.checked,
                        })
                      }
                    />
                    Visible
                  </label>
                  <button
                    type="button"
                    disabled={savingBannerBrand === row.brand}
                    onClick={() => saveBanner(row)}
                    className={buttonSecondaryClassName}
                  >
                    {savingBannerBrand === row.brand ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <label className="mb-4 block max-w-xs text-sm font-medium text-neutral-700">
          Brand
          <select
            value={brand}
            onChange={(e) =>
              navigate({
                search: (prev) => ({
                  ...prev,
                  brand: e.target.value as (typeof STOREFRONT_BRANDS)[number],
                }),
              })
            }
            className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          >
            {STOREFRONT_BRANDS.map((b) => (
              <option key={b} value={b}>
                {STOREFRONT_BRAND_LABELS[b]}
              </option>
            ))}
          </select>
        </label>

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
                brand={brand}
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
              brand={brand}
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

      <div className="sticky top-6 hidden h-[calc(100vh-3rem)] flex-1 flex-col lg:flex">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Preview — {STOREFRONT_BRAND_LABELS[brand]}{' '}
            {STOREFRONT_PAGE_LABELS[page]}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPreviewNonce((n) => n + 1)}
              className="text-xs font-medium text-neutral-500 hover:text-neutral-900"
            >
              Refresh
            </button>
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-neutral-500 hover:text-neutral-900"
            >
              Open in new tab
            </a>
          </div>
        </div>
        <div className="flex-1 overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <iframe
            key={previewNonce}
            src={previewUrl}
            title="Storefront preview"
            className="h-full w-full"
          />
        </div>
      </div>
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
            <video
              src={section.media_url}
              className="h-full w-full object-cover"
              muted
            />
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
      <button
        type="button"
        onClick={onEdit}
        className={buttonSecondaryClassName}
      >
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
  brand,
  collections,
  initial,
  initialType,
  onCancel,
  onSaved,
}: {
  page: StorefrontPage
  brand: (typeof STOREFRONT_BRANDS)[number]
  collections: Collection[]
  initial?: StorefrontSectionWithCollection
  initialType?: StorefrontSectionType
  onCancel: () => void
  onSaved: () => void
}) {
  const type = initial?.type ?? initialType!
  const [title, setTitle] = useState(initial?.title ?? '')
  const [titleJa, setTitleJa] = useState(initial?.title_ja ?? '')
  const [titleKo, setTitleKo] = useState(initial?.title_ko ?? '')
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? '')
  const [subtitleJa, setSubtitleJa] = useState(initial?.subtitle_ja ?? '')
  const [subtitleKo, setSubtitleKo] = useState(initial?.subtitle_ko ?? '')
  const [mediaUrl, setMediaUrl] = useState(initial?.media_url ?? '')
  const [linkUrl, setLinkUrl] = useState(initial?.link_url ?? '')
  const [collectionId, setCollectionId] = useState(initial?.collection_id ?? '')
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
      brand,
      title: title || undefined,
      titleJa: titleJa || undefined,
      titleKo: titleKo || undefined,
      subtitle: subtitle || undefined,
      subtitleJa: subtitleJa || undefined,
      subtitleKo: subtitleKo || undefined,
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
          <>
            <label className={labelClassName}>
              {type === 'tagline' ? 'Heading' : 'Heading (optional)'}
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={inputClassName}
              />
            </label>
            <label className={labelClassName}>
              Heading (Japanese, optional)
              <input
                value={titleJa}
                onChange={(e) => setTitleJa(e.target.value)}
                className={inputClassName}
              />
            </label>
            <label className={labelClassName}>
              Heading (Korean, optional)
              <input
                value={titleKo}
                onChange={(e) => setTitleKo(e.target.value)}
                className={inputClassName}
              />
            </label>
          </>
        )}

        {type === 'tagline' && (
          <>
            <label className={labelClassName}>
              Body text
              <textarea
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                rows={3}
                className={inputClassName}
              />
            </label>
            <label className={labelClassName}>
              Body text (Japanese, optional)
              <textarea
                value={subtitleJa}
                onChange={(e) => setSubtitleJa(e.target.value)}
                rows={3}
                className={inputClassName}
              />
            </label>
            <label className={labelClassName}>
              Body text (Korean, optional)
              <textarea
                value={subtitleKo}
                onChange={(e) => setSubtitleKo(e.target.value)}
                rows={3}
                className={inputClassName}
              />
            </label>
          </>
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
            Link{' '}
            {type === 'product_grid'
              ? '("View all" button, optional)'
              : '(optional)'}
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

import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, ExternalLink } from 'lucide-react'
import {
  createCommunityFit,
  createCommunityFitImageUploadUrl,
  deleteCommunityFit,
  listCommunityFits,
  reorderCommunityFits,
  setCommunityFitActive,
  setCommunityFitProducts,
} from '#/server/admin/community-fits'
import type { CommunityFitWithProducts } from '#/server/admin/community-fits'
import { createCommunityFitSchema } from '#/lib/validation/admin/community-fits'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { resizeImageFile } from '#/lib/utils/file'
import { getErrorMessage } from '#/lib/utils/errors'
import { PageHeader } from '#/components/admin/PageHeader'
import { Card } from '#/components/admin/Card'
import { Badge } from '#/components/admin/Badge'
import { ProductPicker } from '#/components/admin/ProductPicker'
import type { PickedProduct } from '#/components/admin/ProductPicker'
import {
  buttonDangerClassName,
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/admin/ui'

export const Route = createFileRoute('/admin/community-fits/')({
  loader: () => listCommunityFits(),
  component: CommunityFitsPage,
})

function CommunityFitsPage() {
  const fits = Route.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await router.invalidate()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= fits.length) return
    const ids = fits.map((f) => f.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    void run(() => reorderCommunityFits({ data: { ids } }))
  }

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Community Fits"
        subtitle="Instagram posts where customers tagged Spades, with the Spades products in each photo. Shown as a swipeable carousel on the Spades homepage, above New Release. The section hides itself when nothing is shown."
      />

      <AddFitForm onAdded={() => router.invalidate()} />

      <h2 className="mt-8 mb-3 text-sm font-semibold text-neutral-900">
        Posts ({fits.length})
      </h2>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {fits.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-neutral-500">
            No posts yet. Add one above to show the Community Fits section on
            the homepage.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {fits.map((fit, index) => (
            <FitRow
              key={fit.id}
              fit={fit}
              busy={busy}
              isFirst={index === 0}
              isLast={index === fits.length - 1}
              onMoveUp={() => move(index, -1)}
              onMoveDown={() => move(index, 1)}
              onToggle={() =>
                run(() =>
                  setCommunityFitActive({
                    data: { id: fit.id, isActive: !fit.is_active },
                  }),
                )
              }
              onSetProducts={(productIds) =>
                run(() =>
                  setCommunityFitProducts({
                    data: { id: fit.id, productIds },
                  }),
                )
              }
              onDelete={() => {
                if (!window.confirm(`Delete @${fit.handle}'s post?`)) return
                void run(() => deleteCommunityFit({ data: { id: fit.id } }))
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FitRow({
  fit,
  busy,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onToggle,
  onSetProducts,
  onDelete,
}: {
  fit: CommunityFitWithProducts
  busy: boolean
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onToggle: () => void
  onSetProducts: (productIds: string[]) => Promise<void>
  onDelete: () => void
}) {
  const [editingProducts, setEditingProducts] = useState(false)
  const iconButton =
    'rounded-md border border-neutral-200 p-1.5 text-neutral-600 hover:bg-neutral-50 disabled:opacity-30'
  const productIds = fit.products.map((p) => p.id)

  return (
    <Card className="p-3">
      <div className="flex items-center gap-3">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            aria-label="Move up"
            disabled={busy || isFirst}
            onClick={onMoveUp}
            className={iconButton}
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            aria-label="Move down"
            disabled={busy || isLast}
            onClick={onMoveDown}
            className={iconButton}
          >
            <ArrowDown size={14} />
          </button>
        </div>
        <img
          src={fit.image_url}
          alt=""
          className={`h-20 w-16 shrink-0 rounded-md border border-neutral-200 object-cover ${fit.is_active ? '' : 'opacity-40'}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-neutral-900">@{fit.handle}</span>
            <Badge tone={fit.is_active ? 'success' : 'neutral'}>
              {fit.is_active ? 'shown' : 'hidden'}
            </Badge>
          </div>
          <a
            href={fit.instagram_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex max-w-full items-center gap-1 text-xs text-neutral-500 hover:underline"
          >
            <span className="truncate">{fit.instagram_url}</span>
            <ExternalLink size={12} className="shrink-0" />
          </a>
          <p className="mt-1 text-xs text-neutral-600">
            {fit.products.length === 0 ? (
              <span className="text-neutral-400">No products tagged</span>
            ) : (
              fit.products.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ', '}
                  {p.name}
                  {p.status !== 'active' && (
                    <span className="text-amber-600">
                      {' '}
                      ({p.status}, not shown)
                    </span>
                  )}
                </span>
              ))
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => setEditingProducts((v) => !v)}
            className={buttonSecondaryClassName}
          >
            {editingProducts ? 'Done' : 'Products'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onToggle}
            className={buttonSecondaryClassName}
          >
            {fit.is_active ? 'Hide' : 'Show'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className={buttonDangerClassName}
          >
            Delete
          </button>
        </div>
      </div>

      {editingProducts && (
        <div className="mt-3 border-t border-neutral-100 pt-3">
          <p className="mb-2 text-xs text-neutral-500">
            Products shown in this photo. Changes save right away.
          </p>
          <ProductPicker
            selected={fit.products}
            onAdd={(product) => void onSetProducts([...productIds, product.id])}
            onRemove={(productId) =>
              void onSetProducts(productIds.filter((id) => id !== productId))
            }
          />
        </div>
      )}
    </Card>
  )
}

function AddFitForm({ onAdded }: { onAdded: () => Promise<void> }) {
  const [instagramUrl, setInstagramUrl] = useState('')
  const [handle, setHandle] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [products, setProducts] = useState<PickedProduct[]>([])
  const [fileInputKey, setFileInputKey] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleImageUpload(file: File) {
    setUploading(true)
    setError(null)
    try {
      const resized = await resizeImageFile(file, 1200)
      const { path, token, publicUrl } = await createCommunityFitImageUploadUrl(
        {
          data: { fileName: resized.name },
        },
      )
      const { error: uploadError } = await getSupabaseBrowserClient()
        .storage.from('community-fits')
        .uploadToSignedUrl(path, token, resized)
      if (uploadError) throw uploadError
      setImageUrl(publicUrl)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setUploading(false)
    }
  }

  // Not a <form>: ProductPicker renders its own search <form>, and forms
  // can't nest.
  async function handleSubmit() {
    setError(null)
    const input = {
      instagramUrl,
      handle,
      imageUrl,
      productIds: products.map((p) => p.id),
    }
    // Validate in the browser first so a bad link shows a friendly message
    // straight away; the server re-validates with the same schema.
    const parsed = createCommunityFitSchema.safeParse(input)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the fields above')
      return
    }
    setSubmitting(true)
    try {
      await createCommunityFit({ data: input })
      setInstagramUrl('')
      setHandle('')
      setImageUrl('')
      setProducts([])
      setFileInputKey((k) => k + 1)
      await onAdded()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="p-5">
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-neutral-900">Add a post</h2>
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div>
          <label className={labelClassName}>Instagram post link</label>
          <input
            value={instagramUrl}
            onChange={(e) => setInstagramUrl(e.target.value)}
            placeholder="https://www.instagram.com/p/…"
            inputMode="url"
            className={`${inputClassName} w-full`}
          />
        </div>

        <div>
          <label className={labelClassName}>Poster’s @handle</label>
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@username"
            autoCapitalize="none"
            className={`${inputClassName} w-full max-w-xs`}
          />
        </div>

        <div>
          <label className={labelClassName}>Photo</label>
          <p className="mb-2 text-xs text-neutral-500">
            Save the photo from the post (or screenshot it) and upload it here.
            Portrait photos look best.
          </p>
          {imageUrl && (
            <img
              src={imageUrl}
              alt=""
              className="mb-2 aspect-[4/5] w-32 rounded-md border border-neutral-200 object-cover"
            />
          )}
          <input
            key={fileInputKey}
            type="file"
            accept="image/*"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleImageUpload(file)
            }}
            className="text-sm"
          />
          {uploading && (
            <p className="mt-1 text-xs text-neutral-500">Uploading…</p>
          )}
        </div>

        <div>
          <label className={labelClassName}>Products in the photo</label>
          <p className="mb-2 text-xs text-neutral-500">
            Optional — shoppers see a “Shop” link to these on the photo.
          </p>
          <ProductPicker
            selected={products}
            onAdd={(product) =>
              setProducts((prev) => [
                ...prev,
                { id: product.id, name: product.name, image: product.image },
              ])
            }
            onRemove={(productId) =>
              setProducts((prev) => prev.filter((p) => p.id !== productId))
            }
          />
        </div>

        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting || uploading}
          className={buttonPrimaryClassName}
        >
          {submitting ? 'Adding…' : 'Add post'}
        </button>
      </div>
    </Card>
  )
}

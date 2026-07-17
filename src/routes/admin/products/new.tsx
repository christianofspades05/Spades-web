import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Upload, X } from 'lucide-react'
import { listAllCollections } from '#/server/admin/collections'
import {
  createProduct,
  createVariant,
  setProductCollections,
  uploadProductImage,
} from '#/server/admin/products'
import { getErrorMessage } from '#/lib/utils/errors'
import { slugify } from '#/lib/utils/slug'
import { PageHeader } from '#/components/admin/PageHeader'
import { Card } from '#/components/admin/Card'
import { TagsInput } from '#/components/admin/TagsInput'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/admin/ui'

/** Reads a File as a base64 string (no `data:...;base64,` prefix) for the JSON-based upload server fn. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

const PRODUCT_TYPES = [
  'tee',
  'polo',
  'hoodie',
  'jacket',
  'pants',
  'shorts',
  'accessory',
  'other',
] as const
const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const

interface DraftVariant {
  key: string
  sku: string
  size: string
  color: string
  style: string
}

function emptyDraftVariant(): DraftVariant {
  return {
    key: crypto.randomUUID(),
    sku: '',
    size: '',
    color: '',
    style: '',
  }
}

export const Route = createFileRoute('/admin/products/new')({
  loader: () => listAllCollections(),
  component: NewProductPage,
})

function NewProductPage() {
  const collections = Route.useLoaderData()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [productType, setProductType] =
    useState<(typeof PRODUCT_TYPES)[number]>('tee')
  const [status, setStatus] =
    useState<(typeof PRODUCT_STATUSES)[number]>('draft')
  const [imagesText, setImagesText] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [collectionIds, setCollectionIds] = useState<string[]>([])
  const [variants, setVariants] = useState<DraftVariant[]>([])
  const [pricePesos, setPricePesos] = useState(0)
  const [costPesos, setCostPesos] = useState<number | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function toggleCollection(id: string) {
    setCollectionIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    )
  }

  function addVariantRow() {
    setVariants((prev) => [...prev, emptyDraftVariant()])
  }

  function updateVariantRow(key: string, patch: Partial<DraftVariant>) {
    setVariants((prev) =>
      prev.map((v) => (v.key === key ? { ...v, ...patch } : v)),
    )
  }

  function removeVariantRow(key: string) {
    setVariants((prev) => prev.filter((v) => v.key !== key))
  }

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (file.size > 8 * 1024 * 1024) {
      setError('Image must be smaller than 8MB.')
      return
    }

    setUploading(true)
    setError(null)
    try {
      const base64Data = await fileToBase64(file)
      const { url } = await uploadProductImage({
        data: {
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          base64Data,
        },
      })
      setImagesText((prev) => (prev ? `${prev}\n${url}` : url))
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setUploading(false)
    }
  }

  function handleNameChange(value: string) {
    setName(value)
    if (!slugTouched) setSlug(slugify(value))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    // Ignore rows the admin never touched; validate the ones they started filling in.
    const filledVariants = variants.filter(
      (v) => v.sku.trim() || v.size.trim() || v.color.trim() || v.style.trim(),
    )
    for (const v of filledVariants) {
      if (!v.sku.trim()) {
        setError('Each variant needs a SKU.')
        return
      }
    }

    setSubmitting(true)

    const images = imagesText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    try {
      const product = await createProduct({
        data: {
          name,
          slug,
          description: description || undefined,
          productType,
          status,
          images,
          tags,
        },
      })
      if (collectionIds.length > 0) {
        await setProductCollections({
          data: { productId: product.id, collectionIds },
        })
      }
      for (const v of filledVariants) {
        await createVariant({
          data: {
            productId: product.id,
            sku: v.sku.trim(),
            size: v.size.trim() || undefined,
            color: v.color.trim() || undefined,
            style: v.style.trim() || undefined,
            pricePesos,
            costPesos: costPesos === '' ? undefined : costPesos,
            isActive: true,
          },
        })
      }
      await navigate({
        to: '/admin/products/$productId',
        params: { productId: product.id },
      })
    } catch (err) {
      setError(getErrorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader title="Add product" />

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
              placeholder="e.g. classic-tee"
              className={inputClassName}
            />
            <span className="text-xs font-normal text-neutral-500">
              The URL part for this product — /products/{slug || '…'}.
              Auto-filled from the name; lowercase letters, numbers, and hyphens
              only.
            </span>
          </label>
          <label className={labelClassName}>
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={14}
              className={inputClassName}
            />
          </label>
          <div className="flex gap-4">
            <label className={`flex-1 ${labelClassName}`}>
              Type
              <select
                value={productType}
                onChange={(e) =>
                  setProductType(
                    e.target.value as (typeof PRODUCT_TYPES)[number],
                  )
                }
                className={inputClassName}
              >
                {PRODUCT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className={`flex-1 ${labelClassName}`}>
              Status
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as (typeof PRODUCT_STATUSES)[number])
                }
                className={inputClassName}
              >
                {PRODUCT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={labelClassName}>
            Image URLs (one per line)
            <textarea
              value={imagesText}
              onChange={(e) => setImagesText(e.target.value)}
              rows={3}
              placeholder="https://…"
              className={inputClassName}
            />
          </label>
          <label className={`${buttonSecondaryClassName} w-fit cursor-pointer`}>
            <Upload size={14} className="mr-1.5 -ml-0.5 inline" />
            {uploading ? 'Uploading…' : 'Upload from computer'}
            <input
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              disabled={uploading}
              className="hidden"
            />
          </label>
          <label className={labelClassName}>
            Tags
            <TagsInput tags={tags} onChange={setTags} />
          </label>

          <div className="flex flex-col gap-3 border-t border-neutral-100 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-neutral-700">
                Variants
              </span>
              <button
                type="button"
                onClick={addVariantRow}
                className={`${buttonSecondaryClassName} px-2 py-1 text-xs`}
              >
                + Add variant
              </button>
            </div>

            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
                Price (PHP)
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={pricePesos}
                  onChange={(e) =>
                    setPricePesos(
                      e.target.value === '' ? 0 : Number(e.target.value),
                    )
                  }
                  className={`${inputClassName} w-24`}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
                Cost per item (PHP)
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={costPesos}
                  onChange={(e) =>
                    setCostPesos(
                      e.target.value === '' ? '' : Number(e.target.value),
                    )
                  }
                  className={`${inputClassName} w-28`}
                />
              </label>
            </div>

            {variants.length === 0 ? (
              <p className="text-xs text-neutral-500">
                No variants added yet — add size/color options below, they'll
                all use the price and cost set above.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {variants.map((v) => (
                  <div
                    key={v.key}
                    className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-neutral-300 p-3"
                  >
                    <label className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
                      SKU
                      <input
                        value={v.sku}
                        onChange={(e) =>
                          updateVariantRow(v.key, { sku: e.target.value })
                        }
                        className={`${inputClassName} w-28`}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
                      Size
                      <input
                        value={v.size}
                        onChange={(e) =>
                          updateVariantRow(v.key, { size: e.target.value })
                        }
                        className={`${inputClassName} w-16`}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
                      Color
                      <input
                        value={v.color}
                        onChange={(e) =>
                          updateVariantRow(v.key, { color: e.target.value })
                        }
                        className={`${inputClassName} w-20`}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
                      Style
                      <input
                        value={v.style}
                        onChange={(e) =>
                          updateVariantRow(v.key, { style: e.target.value })
                        }
                        className={`${inputClassName} w-20`}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeVariantRow(v.key)}
                      className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-red-600"
                      aria-label="Remove variant"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {collections.length > 0 && (
            <fieldset className="flex flex-col gap-1">
              <legend className="text-sm font-medium text-neutral-700">
                Collections
              </legend>
              {collections.map((collection) => (
                <label
                  key={collection.id}
                  className="flex items-center gap-2 text-sm text-neutral-700"
                >
                  <input
                    type="checkbox"
                    checked={collectionIds.includes(collection.id)}
                    onChange={() => toggleCollection(collection.id)}
                  />
                  {collection.name}
                </label>
              ))}
            </fieldset>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className={buttonPrimaryClassName}
          >
            {submitting ? 'Creating…' : 'Create product'}
          </button>
        </form>
      </Card>
    </div>
  )
}

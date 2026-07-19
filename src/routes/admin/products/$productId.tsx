import { useState } from 'react'
import {
  createFileRoute,
  notFound,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { Copy, Package, Pencil, Upload, X } from 'lucide-react'
import { listAllCollections } from '#/server/admin/collections'
import {
  createVariant,
  duplicateProduct,
  getProductById,
  getProductSalesSummary,
  setProductCollections,
  updateProduct,
  updateVariant,
  uploadProductImage,
} from '#/server/admin/products'
import { centsToPesos, formatCentsAsPHP } from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import { fileToBase64 } from '#/lib/utils/file'
import { useUndoableState } from '#/lib/hooks/useUndoableState'
import { useUndoRedoShortcuts } from '#/lib/hooks/useUndoRedoShortcuts'
import { PageHeader } from '#/components/admin/PageHeader'
import { Card } from '#/components/admin/Card'
import { QuantityEditor } from '#/components/admin/QuantityEditor'
import { TagsInput } from '#/components/admin/TagsInput'
import { UndoRedoButtons } from '#/components/admin/UndoRedoButtons'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
  labelClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'
import type {
  Inventory,
  ProductStatus,
  ProductType,
  ProductVariant,
} from '#/types/entities'

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

const FORM_ID = 'product-edit-form'

export const Route = createFileRoute('/admin/products/$productId')({
  loader: async ({ params }) => {
    const [product, collections, sales] = await Promise.all([
      getProductById({ data: { id: params.productId } }),
      listAllCollections(),
      getProductSalesSummary({ data: { productId: params.productId } }),
    ])
    if (!product) throw notFound()
    return { product, collections, sales }
  },
  component: EditProductPage,
})

interface ProductFormState {
  name: string
  slug: string
  description: string
  productType: ProductType
  status: ProductStatus
  images: string[]
  tags: string[]
  collectionIds: string[]
}

function EditProductPage() {
  const { product, collections, sales } = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()

  const {
    value: form,
    set: setForm,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useUndoableState<ProductFormState>({
    name: product.name,
    slug: product.slug,
    description: product.description ?? '',
    productType: product.product_type,
    status: product.status,
    images: product.images,
    tags: product.tags,
    collectionIds: product.collections.map((c) => c.collection_id),
  })
  useUndoRedoShortcuts(undo, redo)

  const [newImageUrl, setNewImageUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [duplicateOpen, setDuplicateOpen] = useState(false)

  function toggleCollection(id: string) {
    setForm({
      ...form,
      collectionIds: form.collectionIds.includes(id)
        ? form.collectionIds.filter((c) => c !== id)
        : [...form.collectionIds, id],
    })
  }

  function addImage() {
    const url = newImageUrl.trim()
    if (!url) return
    setForm({ ...form, images: [...form.images, url] })
    setNewImageUrl('')
  }

  function removeImage(index: number) {
    setForm({ ...form, images: form.images.filter((_, i) => i !== index) })
  }

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return

    const tooLarge = files.filter((f) => f.size > 8 * 1024 * 1024)
    const toUpload = files.filter((f) => f.size <= 8 * 1024 * 1024)

    setUploading(true)
    setError(null)
    const results = await Promise.allSettled(
      toUpload.map(async (file) => {
        const base64Data = await fileToBase64(file)
        const { url } = await uploadProductImage({
          data: {
            fileName: file.name,
            contentType: file.type || 'application/octet-stream',
            base64Data,
          },
        })
        return url
      }),
    )
    const uploaded = results
      .filter(
        (r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled',
      )
      .map((r) => r.value)
    const failedCount = results.filter((r) => r.status === 'rejected').length

    if (uploaded.length > 0) {
      setForm({ ...form, images: [...form.images, ...uploaded] })
    }
    if (tooLarge.length > 0 || failedCount > 0) {
      const parts: string[] = []
      if (tooLarge.length > 0) {
        parts.push(
          `${tooLarge.length} image${tooLarge.length === 1 ? '' : 's'} over 8MB (${tooLarge
            .map((f) => f.name)
            .join(', ')})`,
        )
      }
      if (failedCount > 0) {
        parts.push(
          `${failedCount} upload${failedCount === 1 ? '' : 's'} failed`,
        )
      }
      setError(parts.join('; '))
    }
    setUploading(false)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setSaved(false)

    try {
      await updateProduct({
        data: {
          id: product.id,
          name: form.name,
          slug: form.slug,
          description: form.description || undefined,
          productType: form.productType,
          status: form.status,
          images: form.images,
          tags: form.tags,
        },
      })
      await setProductCollections({
        data: { productId: product.id, collectionIds: form.collectionIds },
      })
      setSaved(true)
      await router.invalidate()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title={product.name}
        subtitle={product.slug}
        action={
          <div className="flex items-center gap-3">
            {saved && <span className="text-sm text-green-700">Saved.</span>}
            <UndoRedoButtons
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={undo}
              onRedo={redo}
            />
            <button
              type="button"
              onClick={() => setDuplicateOpen(true)}
              className={buttonSecondaryClassName}
            >
              <Copy size={14} className="mr-1.5 -ml-0.5 inline" />
              Duplicate
            </button>
            <button
              type="submit"
              form={FORM_ID}
              disabled={submitting}
              className={buttonPrimaryClassName}
            >
              {submitting ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        }
      />
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {duplicateOpen && (
        <DuplicateProductModal
          productId={product.id}
          defaultName={`${product.name} copy`}
          onClose={() => setDuplicateOpen(false)}
          onDuplicated={(newProductId) =>
            navigate({
              to: '/admin/products/$productId',
              params: { productId: newProductId },
            })
          }
        />
      )}

      <form id={FORM_ID} onSubmit={handleSubmit}>
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-6">
            <Card className="p-6">
              <div className="flex flex-col gap-4">
                <label className={labelClassName}>
                  Title
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={inputClassName}
                  />
                </label>
                <label className={labelClassName}>
                  Slug
                  <input
                    required
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    className={inputClassName}
                  />
                </label>
                <label className={labelClassName}>
                  Description
                  <textarea
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    rows={16}
                    className={inputClassName}
                  />
                </label>
              </div>
            </Card>

            <Card className="p-6">
              <p className="mb-3 text-sm font-semibold text-neutral-900">
                Media
              </p>
              <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
                {form.images.map((src, index) => (
                  <div
                    key={`${src}-${index}`}
                    className="group relative aspect-square overflow-hidden rounded-md border border-neutral-200"
                  >
                    <img
                      src={src}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white opacity-0 group-hover:opacity-100"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={newImageUrl}
                  onChange={(e) => setNewImageUrl(e.target.value)}
                  placeholder="Image URL"
                  className={`${inputClassName} flex-1`}
                />
                <button
                  type="button"
                  onClick={addImage}
                  className={buttonSecondaryClassName}
                >
                  Add
                </button>
              </div>
              <div className="mt-2">
                <label
                  className={`${buttonSecondaryClassName} w-fit cursor-pointer`}
                >
                  <Upload size={14} className="mr-1.5 -ml-0.5 inline" />
                  {uploading ? 'Uploading…' : 'Upload from computer'}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileSelect}
                    disabled={uploading}
                    className="hidden"
                  />
                </label>
              </div>
            </Card>
          </div>

          <div className="flex flex-col gap-6">
            <Card className="p-5">
              <label className={labelClassName}>
                Status
                <select
                  value={form.status}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      status: e.target
                        .value as (typeof PRODUCT_STATUSES)[number],
                    })
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
            </Card>

            <Card className="p-5">
              <p className="mb-2 text-sm font-semibold text-neutral-900">
                Sales
              </p>
              {sales.unitsSold === 0 ? (
                <p className="text-sm text-neutral-500">
                  No sales of this product yet.
                </p>
              ) : (
                <p className="text-sm text-neutral-700">
                  {sales.unitsSold} {sales.unitsSold === 1 ? 'unit' : 'units'}{' '}
                  sold · {formatCentsAsPHP(sales.revenueCents)} revenue
                </p>
              )}
            </Card>

            <Card className="p-5">
              <p className="mb-3 text-sm font-semibold text-neutral-900">
                Product organization
              </p>
              <div className="flex flex-col gap-4">
                <label className={labelClassName}>
                  Type
                  <select
                    value={form.productType}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        productType: e.target
                          .value as (typeof PRODUCT_TYPES)[number],
                      })
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

                {collections.length > 0 && (
                  <fieldset className="flex flex-col gap-1">
                    <legend className="mb-1 text-sm font-medium text-neutral-700">
                      Collections
                    </legend>
                    {collections.map((collection) => (
                      <label
                        key={collection.id}
                        className="flex items-center gap-2 text-sm text-neutral-700"
                      >
                        <input
                          type="checkbox"
                          checked={form.collectionIds.includes(collection.id)}
                          onChange={() => toggleCollection(collection.id)}
                        />
                        {collection.name}
                      </label>
                    ))}
                  </fieldset>
                )}

                <label className={labelClassName}>
                  Tags
                  <TagsInput
                    tags={form.tags}
                    onChange={(tags) => setForm({ ...form, tags })}
                  />
                </label>
              </div>
            </Card>
          </div>
        </div>
      </form>

      <VariantsSection
        product={product}
        onChanged={() => router.invalidate()}
      />
    </div>
  )
}

function variantLabel(variant: ProductVariant): string {
  return (
    [variant.size, variant.color, variant.style].filter(Boolean).join(' / ') ||
    'Default'
  )
}

function VariantsSection({
  product,
  onChanged,
}: {
  product: {
    id: string
    status: (typeof PRODUCT_STATUSES)[number]
    variants: Array<ProductVariant & { inventory: Inventory[] }>
  }
  onChanged: () => void
}) {
  const [addingNew, setAddingNew] = useState(false)
  const totalAvailable = product.variants.reduce(
    (sum, v) => sum + (v.inventory[0]?.quantity_available ?? 0),
    0,
  )

  return (
    <>
      <div className="mt-10 mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Variants
        </h2>
        <button
          type="button"
          onClick={() => setAddingNew((v) => !v)}
          className={buttonSecondaryClassName}
        >
          {addingNew ? 'Cancel' : 'Add variant'}
        </button>
      </div>

      <div className={tableWrapperClassName}>
        <table className="w-full">
          <thead>
            <tr>
              <th className={tableHeadClassName}>Variant</th>
              <th className={tableHeadClassName}>Price</th>
              <th className={tableHeadClassName}>Available</th>
              <th className={tableHeadClassName} />
            </tr>
          </thead>
          <tbody>
            {product.variants.map((variant) => (
              <VariantRow
                key={variant.id}
                variant={variant}
                inventory={variant.inventory[0] ?? null}
                onSaved={onChanged}
              />
            ))}
          </tbody>
          <tfoot>
            <tr className={tableRowClassName}>
              <td
                colSpan={4}
                className={`${tableCellClassName} text-neutral-500`}
              >
                Total inventory: {totalAvailable} available
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {addingNew && (
        <div className="mt-4">
          <NewVariantForm
            productId={product.id}
            onCreated={() => {
              setAddingNew(false)
              onChanged()
            }}
          />
        </div>
      )}
    </>
  )
}

function VariantRow({
  variant,
  inventory,
  onSaved,
}: {
  variant: ProductVariant
  inventory: Inventory | null
  onSaved: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  const [sku, setSku] = useState(variant.sku)
  const [size, setSize] = useState(variant.size ?? '')
  const [color, setColor] = useState(variant.color ?? '')
  const [style, setStyle] = useState(variant.style ?? '')
  const [isActive, setIsActive] = useState(variant.is_active)
  const [pricePesos, setPricePesos] = useState(
    centsToPesos(variant.price_cents),
  )
  const [costPesos, setCostPesos] = useState(
    variant.cost_cents !== null ? centsToPesos(variant.cost_cents) : '',
  )
  const [priceSaving, setPriceSaving] = useState(false)
  const [detailsSaving, setDetailsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function savePrice() {
    if (centsToPesos(variant.price_cents) === pricePesos) return
    setPriceSaving(true)
    setError(null)
    try {
      await updateVariant({
        data: {
          id: variant.id,
          productId: variant.product_id,
          sku,
          size: size || undefined,
          color: color || undefined,
          style: style || undefined,
          pricePesos,
          costPesos: costPesos === '' ? undefined : Number(costPesos),
          isActive,
        },
      })
      onSaved()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setPriceSaving(false)
    }
  }

  async function saveDetails(event: React.FormEvent) {
    event.preventDefault()
    setDetailsSaving(true)
    setError(null)
    try {
      await updateVariant({
        data: {
          id: variant.id,
          productId: variant.product_id,
          sku,
          size: size || undefined,
          color: color || undefined,
          style: style || undefined,
          pricePesos,
          costPesos: costPesos === '' ? undefined : Number(costPesos),
          isActive,
        },
      })
      setExpanded(false)
      onSaved()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setDetailsSaving(false)
    }
  }

  return (
    <>
      <tr className={tableRowClassName}>
        <td className={tableCellClassName}>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50">
              <Package size={14} className="text-neutral-300" />
            </div>
            <div>
              <p className="font-medium text-neutral-900">
                {variantLabel(variant)}
              </p>
              <p className="text-xs text-neutral-500">{variant.sku}</p>
            </div>
          </div>
        </td>
        <td className={tableCellClassName}>
          <div className="flex items-center gap-2">
            <span className="text-neutral-400">₱</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={pricePesos}
              onChange={(e) => setPricePesos(Number(e.target.value))}
              onBlur={savePrice}
              className={`${inputClassName} w-28`}
            />
            {priceSaving && (
              <span className="text-xs text-neutral-400">Saving…</span>
            )}
          </div>
        </td>
        <td className={tableCellClassName}>
          <QuantityEditor
            variantId={variant.id}
            quantity={inventory?.quantity_on_hand ?? 0}
            onSaved={onSaved}
          />
        </td>
        <td className={`${tableCellClassName} text-right`}>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900"
          >
            <Pencil size={12} />
            {expanded ? 'Close' : 'Edit'}
          </button>
        </td>
      </tr>

      {error && (
        <tr>
          <td colSpan={4} className="px-4 pb-2 text-sm text-red-600">
            {error}
          </td>
        </tr>
      )}

      {expanded && (
        <tr className="bg-neutral-50">
          <td colSpan={4} className="px-4 pb-4">
            <form
              onSubmit={saveDetails}
              className="flex flex-wrap items-end gap-3 pt-2"
            >
              <label className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
                SKU
                <input
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  className={`${inputClassName} w-32`}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
                Size
                <input
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  className={`${inputClassName} w-20`}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
                Color
                <input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className={`${inputClassName} w-24`}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
                Style
                <input
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
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
              <label className="flex items-center gap-2 text-xs font-medium text-neutral-700">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Active
              </label>
              <button
                type="submit"
                disabled={detailsSaving}
                className={buttonPrimaryClassName}
              >
                {detailsSaving ? 'Saving…' : 'Save'}
              </button>
            </form>
          </td>
        </tr>
      )}
    </>
  )
}

function NewVariantForm({
  productId,
  onCreated,
}: {
  productId: string
  onCreated: () => void
}) {
  const [sku, setSku] = useState('')
  const [size, setSize] = useState('')
  const [color, setColor] = useState('')
  const [style, setStyle] = useState('')
  const [pricePesos, setPricePesos] = useState(0)
  const [costPesos, setCostPesos] = useState<number | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await createVariant({
        data: {
          productId,
          sku,
          size: size || undefined,
          color: color || undefined,
          style: style || undefined,
          pricePesos,
          costPesos: costPesos === '' ? undefined : costPesos,
          isActive: true,
        },
      })
      onCreated()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-neutral-300 bg-white p-4"
    >
      <label className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
        SKU
        <input
          required
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          className={`${inputClassName} w-32`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
        Size
        <input
          value={size}
          onChange={(e) => setSize(e.target.value)}
          className={`${inputClassName} w-20`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
        Color
        <input
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className={`${inputClassName} w-24`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
        Style
        <input
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          className={`${inputClassName} w-24`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
        Price (PHP)
        <input
          type="number"
          step="0.01"
          min="0"
          required
          value={pricePesos}
          onChange={(e) => setPricePesos(Number(e.target.value))}
          className={`${inputClassName} w-28`}
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
            setCostPesos(e.target.value === '' ? '' : Number(e.target.value))
          }
          className={`${inputClassName} w-28`}
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className={buttonPrimaryClassName}
      >
        {submitting ? 'Adding…' : 'Add variant'}
      </button>
    </form>
  )
}

function DuplicateProductModal({
  productId,
  defaultName,
  onClose,
  onDuplicated,
}: {
  productId: string
  defaultName: string
  onClose: () => void
  onDuplicated: (newProductId: string) => void
}) {
  const [newName, setNewName] = useState(defaultName)
  const [duplicateImages, setDuplicateImages] = useState(true)
  const [duplicateVariants, setDuplicateVariants] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const duplicated = await duplicateProduct({
        data: { productId, newName, duplicateImages, duplicateVariants },
      })
      onDuplicated(duplicated.id)
    } catch (err) {
      setError(getErrorMessage(err))
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-md p-6">
        <h2 className="mb-1 text-base font-semibold text-neutral-900">
          Duplicate product
        </h2>
        <p className="mb-4 text-sm text-neutral-500">
          Description and collections always come along. The new product is
          created as a draft.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className={labelClassName}>
            New title
            <input
              required
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={inputClassName}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={duplicateImages}
              onChange={(e) => setDuplicateImages(e.target.checked)}
            />
            Duplicate pictures
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={duplicateVariants}
              onChange={(e) => setDuplicateVariants(e.target.checked)}
            />
            Duplicate variants and quantities
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="mt-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className={buttonSecondaryClassName}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={buttonPrimaryClassName}
            >
              {submitting ? 'Duplicating…' : 'Duplicate product'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  )
}

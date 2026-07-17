import { useState } from 'react'
import { createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { GripVertical, Package, Search, Trash2, X } from 'lucide-react'
import {
  addProductToCollection,
  getCollectionById,
  getCollectionProducts,
  pinAndReorderCollectionProducts,
  previewCollectionRules,
  removeProductFromCollection,
  updateCollection,
} from '#/server/admin/collections'
import type { CollectionProduct } from '#/server/admin/collections'
import { searchProductsForPicker } from '#/server/admin/products'
import type { ProductPickerResult } from '#/server/admin/products'
import {
  OPERATORS_BY_FIELD,
  RULE_FIELDS,
  SORT_LABELS,
  SORT_OPTIONS,
} from '#/lib/collections/rules'
import type {
  CollectionRule,
  RuleField,
  RuleOperator,
  SortOption,
} from '#/lib/collections/rules'
import { getErrorMessage } from '#/lib/utils/errors'
import { useUndoableState } from '#/lib/hooks/useUndoableState'
import { useUndoRedoShortcuts } from '#/lib/hooks/useUndoRedoShortcuts'
import { PageHeader } from '#/components/admin/PageHeader'
import { Card } from '#/components/admin/Card'
import { UndoRedoButtons } from '#/components/admin/UndoRedoButtons'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/admin/ui'
import type { CollectionMatchType } from '#/types/entities'

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

const FIELD_LABELS: Record<RuleField, string> = {
  title: 'Title',
  product_type: 'Product type',
  status: 'Status',
  tags: 'Tag',
  inventory_stock: 'Inventory stock',
  price: 'Price',
}
const OPERATOR_LABELS: Record<RuleOperator, string> = {
  contains: 'contains',
  does_not_contain: 'does not contain',
  is_equal_to: 'is equal to',
  is_not_equal_to: 'is not equal to',
  starts_with: 'starts with',
  ends_with: 'ends with',
  is_greater_than: 'is greater than',
  is_less_than: 'is less than',
}

function defaultValueFor(field: RuleField): string {
  if (field === 'product_type') return PRODUCT_TYPES[0]
  if (field === 'status') return PRODUCT_STATUSES[0]
  if (field === 'inventory_stock' || field === 'price') return '0'
  return ''
}

export const Route = createFileRoute('/admin/collections/$collectionId')({
  loader: async ({ params }) => {
    const collection = await getCollectionById({
      data: { id: params.collectionId },
    })
    if (!collection) throw notFound()

    const [manualProducts, previewProducts] = await Promise.all([
      getCollectionProducts({ data: { collectionId: params.collectionId } }),
      previewCollectionRules({
        data: {
          rules: collection.rules as CollectionRule[],
          matchType: collection.match_type,
          sortBy: collection.sort_by as SortOption,
          hideOutOfStockProducts: collection.hide_out_of_stock_products,
        },
      }),
    ])

    return { collection, manualProducts, previewProducts }
  },
  component: EditCollectionPage,
})

interface CollectionFormState {
  name: string
  slug: string
  description: string
  imageUrl: string
  isActive: boolean
  sortOrder: number
  hideOutOfStockProducts: boolean
  matchType: CollectionMatchType
  rules: CollectionRule[]
  sortBy: SortOption
}

function EditCollectionPage() {
  const { collection, manualProducts, previewProducts } = Route.useLoaderData()
  const router = useRouter()

  const {
    value: form,
    set: setForm,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useUndoableState<CollectionFormState>({
    name: collection.name,
    slug: collection.slug,
    description: collection.description ?? '',
    imageUrl: collection.image_url ?? '',
    isActive: collection.is_active,
    sortOrder: collection.sort_order,
    hideOutOfStockProducts: collection.hide_out_of_stock_products,
    matchType: collection.match_type,
    rules: collection.rules as CollectionRule[],
    sortBy: collection.sort_by as SortOption,
  })
  useUndoRedoShortcuts(undo, redo)

  const [preview, setPreview] = useState(previewProducts)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [manualProductsState, setManualProducts] = useState(manualProducts)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved] = useState(false)

  const manualIds = new Set(manualProductsState.map((p) => p.productId))
  const autoMatchedOnly = preview.filter((p) => !manualIds.has(p.productId))

  function addRule() {
    setForm({
      ...form,
      rules: [
        ...form.rules,
        { field: 'title', operator: 'contains', value: '' },
      ],
    })
  }

  function updateRuleField(index: number, field: RuleField) {
    setForm({
      ...form,
      rules: form.rules.map((r, i) =>
        i === index
          ? {
              field,
              operator: OPERATORS_BY_FIELD[field][0],
              value: defaultValueFor(field),
            }
          : r,
      ),
    })
  }

  function updateRule(index: number, patch: Partial<CollectionRule>) {
    setForm({
      ...form,
      rules: form.rules.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    })
  }

  function removeRule(index: number) {
    setForm({ ...form, rules: form.rules.filter((_, i) => i !== index) })
  }

  async function handlePreview() {
    setPreviewLoading(true)
    setError(null)
    try {
      const results = await previewCollectionRules({
        data: {
          rules: form.rules,
          matchType: form.matchType,
          sortBy: form.sortBy,
          hideOutOfStockProducts: form.hideOutOfStockProducts,
        },
      })
      setPreview(results)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setSaved(false)

    try {
      await updateCollection({
        data: {
          id: collection.id,
          slug: form.slug,
          name: form.name,
          description: form.description || undefined,
          imageUrl: form.imageUrl || undefined,
          isActive: form.isActive,
          sortOrder: form.sortOrder,
          hideOutOfStockProducts: form.hideOutOfStockProducts,
          matchType: form.matchType,
          rules: form.rules,
          sortBy: form.sortBy,
        },
      })
      setSaved(true)
      await Promise.all([router.invalidate(), handlePreview()])
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Edit collection"
        action={
          <UndoRedoButtons
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
          />
        }
      />

      <Card className="p-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className={labelClassName}>
            Name
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
              rows={3}
              className={inputClassName}
            />
          </label>
          <label className={labelClassName}>
            Image URL
            <input
              value={form.imageUrl}
              onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
              className={inputClassName}
            />
          </label>
          <label className={labelClassName}>
            Sort order
            <input
              type="number"
              value={form.sortOrder}
              onChange={(e) =>
                setForm({ ...form, sortOrder: Number(e.target.value) })
              }
              className={`${inputClassName} w-24`}
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Active (visible on storefront)
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
            <input
              type="checkbox"
              checked={form.hideOutOfStockProducts}
              onChange={(e) =>
                setForm({ ...form, hideOutOfStockProducts: e.target.checked })
              }
            />
            Hide out-of-stock products on the storefront
          </label>

          <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4">
            <div>
              <p className="text-sm font-medium text-neutral-900">
                Auto-match conditions (optional)
              </p>
              <p className="text-xs text-neutral-500">
                Products matching these are added automatically, on top of
                whatever you add manually below — manually added products are
                never excluded by these conditions.
              </p>
            </div>

            {form.rules.length > 0 && (
              <div className="flex gap-4">
                <p className="text-sm text-neutral-700">Match:</p>
                <label className="flex items-center gap-2 text-sm text-neutral-700">
                  <input
                    type="radio"
                    name="matchType"
                    checked={form.matchType === 'all'}
                    onChange={() => setForm({ ...form, matchType: 'all' })}
                  />
                  all conditions
                </label>
                <label className="flex items-center gap-2 text-sm text-neutral-700">
                  <input
                    type="radio"
                    name="matchType"
                    checked={form.matchType === 'any'}
                    onChange={() => setForm({ ...form, matchType: 'any' })}
                  />
                  any condition
                </label>
              </div>
            )}

            {form.rules.map((rule, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <select
                  value={rule.field}
                  onChange={(e) =>
                    updateRuleField(index, e.target.value as RuleField)
                  }
                  className={`${inputClassName} w-auto`}
                >
                  {RULE_FIELDS.map((field) => (
                    <option key={field} value={field}>
                      {FIELD_LABELS[field]}
                    </option>
                  ))}
                </select>
                <select
                  value={rule.operator}
                  onChange={(e) =>
                    updateRule(index, {
                      operator: e.target.value as RuleOperator,
                    })
                  }
                  className={`${inputClassName} w-auto`}
                >
                  {OPERATORS_BY_FIELD[rule.field].map((op) => (
                    <option key={op} value={op}>
                      {OPERATOR_LABELS[op]}
                    </option>
                  ))}
                </select>
                {rule.field === 'product_type' ? (
                  <select
                    value={rule.value}
                    onChange={(e) =>
                      updateRule(index, { value: e.target.value })
                    }
                    className={`${inputClassName} w-auto`}
                  >
                    {PRODUCT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                ) : rule.field === 'status' ? (
                  <select
                    value={rule.value}
                    onChange={(e) =>
                      updateRule(index, { value: e.target.value })
                    }
                    className={`${inputClassName} w-auto`}
                  >
                    {PRODUCT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={
                      rule.field === 'inventory_stock' || rule.field === 'price'
                        ? 'number'
                        : 'text'
                    }
                    value={rule.value}
                    onChange={(e) =>
                      updateRule(index, { value: e.target.value })
                    }
                    className={`${inputClassName} w-40`}
                  />
                )}
                <button
                  type="button"
                  onClick={() => removeRule(index)}
                  className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-red-600"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={addRule}
              className={`${buttonSecondaryClassName} w-fit`}
            >
              + Add a condition
            </button>

            {form.rules.length > 0 && (
              <>
                <label className={labelClassName}>
                  Sort by (for auto-matched products)
                  <select
                    value={form.sortBy}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        sortBy: e.target.value as SortOption,
                      })
                    }
                    className={`${inputClassName} w-auto`}
                  >
                    {SORT_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {SORT_LABELS[opt]}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={previewLoading}
                  className={`${buttonSecondaryClassName} w-fit`}
                >
                  {previewLoading ? 'Checking…' : 'Preview matches'}
                </button>
              </>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {saved && <p className="text-sm text-green-700">Saved.</p>}
          <button
            type="submit"
            disabled={submitting}
            className={buttonPrimaryClassName}
          >
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </Card>

      <CollectionProductsList
        collectionId={collection.id}
        manualProducts={manualProductsState}
        autoMatchedProducts={autoMatchedOnly}
        onManualProductsChange={setManualProducts}
      />
    </div>
  )
}

function CollectionProductsList({
  collectionId,
  manualProducts,
  autoMatchedProducts,
  onManualProductsChange,
}: {
  collectionId: string
  manualProducts: CollectionProduct[]
  autoMatchedProducts: CollectionProduct[]
  onManualProductsChange: (products: CollectionProduct[]) => void
}) {
  const router = useRouter()
  const combined = [...manualProducts, ...autoMatchedProducts]
  const pinnedIds = new Set(manualProducts.map((p) => p.productId))
  const assignedIds = new Set(combined.map((p) => p.productId))

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerResults, setPickerResults] = useState<ProductPickerResult[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function persistPinnedOrder(next: CollectionProduct[]) {
    onManualProductsChange(next)
    try {
      await pinAndReorderCollectionProducts({
        data: {
          collectionId,
          orderedProductIds: next.map((p) => p.productId),
        },
      })
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) return
    const next = [...combined]
    const [moved] = next.splice(dragIndex, 1)
    next.splice(targetIndex, 0, moved)
    setDragIndex(null)
    // Dragging pins the whole visible list into product_collections, in this
    // order — including items that were only here because they currently
    // match the auto-match conditions above.
    void persistPinnedOrder(next)
  }

  async function handleRemove(productId: string) {
    onManualProductsChange(
      manualProducts.filter((p) => p.productId !== productId),
    )
    try {
      await removeProductFromCollection({ data: { collectionId, productId } })
    } catch (err) {
      setError(getErrorMessage(err))
      await router.invalidate()
    }
  }

  async function handleAdd(product: ProductPickerResult) {
    setError(null)
    try {
      await addProductToCollection({
        data: { collectionId, productId: product.id },
      })
      onManualProductsChange([
        ...manualProducts,
        {
          productId: product.id,
          name: product.name,
          slug: product.slug,
          image: product.image,
          sortOrder: manualProducts.length,
          inStock: true,
        },
      ])
      setPickerResults((prev) => prev.filter((p) => p.id !== product.id))
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  async function handlePickerSearch(event: React.FormEvent) {
    event.preventDefault()
    setPickerLoading(true)
    try {
      const results = await searchProductsForPicker({
        data: { q: pickerQuery || undefined },
      })
      setPickerResults(results.filter((p) => !assignedIds.has(p.id)))
    } finally {
      setPickerLoading(false)
    }
  }

  return (
    <>
      <h2 className="mt-10 mb-1 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Products in this collection ({combined.length})
      </h2>
      <p className="mb-4 text-xs text-neutral-500">
        Drag any product to reorder it — dragging one that only matches your
        conditions above locks its position in, even if the conditions change
        later.
      </p>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <Card className="mb-6 p-2">
        {combined.length === 0 ? (
          <p className="p-4 text-sm text-neutral-500">
            No products in this collection yet. Add some below, or add a
            condition above.
          </p>
        ) : (
          <ul>
            {combined.map((product, index) => (
              <li
                key={product.productId}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(index)}
                className="flex items-center gap-3 border-b border-neutral-100 px-2 py-2 last:border-b-0"
              >
                <GripVertical
                  size={16}
                  className="cursor-grab text-neutral-300"
                />
                {product.image ? (
                  <img
                    src={product.image}
                    alt=""
                    className="size-9 rounded-md border border-neutral-200 object-cover"
                  />
                ) : (
                  <div className="flex size-9 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50">
                    <Package size={14} className="text-neutral-300" />
                  </div>
                )}
                <span className="flex-1 text-sm font-medium text-neutral-900">
                  {product.name}
                </span>
                {!product.inStock && (
                  <span className="text-xs text-neutral-400">Out of stock</span>
                )}
                {!pinnedIds.has(product.productId) && (
                  <span className="text-xs text-neutral-400">Auto</span>
                )}
                {pinnedIds.has(product.productId) && (
                  <button
                    type="button"
                    onClick={() => handleRemove(product.productId)}
                    className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <form
        onSubmit={handlePickerSearch}
        className="mb-3 flex max-w-sm items-center gap-2"
      >
        <div className="relative flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-neutral-400"
          />
          <input
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            placeholder="Search products to add"
            className={`${inputClassName} w-full pl-8`}
          />
        </div>
        <button type="submit" className={buttonSecondaryClassName}>
          {pickerLoading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {pickerResults.length > 0 && (
        <Card className="p-2">
          <ul>
            {pickerResults.map((product) => (
              <li
                key={product.id}
                className="flex items-center gap-3 border-b border-neutral-100 px-2 py-2 last:border-b-0"
              >
                {product.image ? (
                  <img
                    src={product.image}
                    alt=""
                    className="size-9 rounded-md border border-neutral-200 object-cover"
                  />
                ) : (
                  <div className="flex size-9 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50">
                    <Package size={14} className="text-neutral-300" />
                  </div>
                )}
                <span className="flex-1 text-sm font-medium text-neutral-900">
                  {product.name}
                </span>
                <button
                  type="button"
                  onClick={() => handleAdd(product)}
                  className={`${buttonSecondaryClassName} px-2 py-1 text-xs`}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}

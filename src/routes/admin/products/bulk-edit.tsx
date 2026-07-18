import { Fragment, useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ChevronDown, Package } from 'lucide-react'
import { listAllCollections } from '#/server/admin/collections'
import {
  adjustInventory,
  getProductsByIds,
  setProductCollections,
  updateProduct,
  updateVariant,
} from '#/server/admin/products'
import { centsToPesos } from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import { useUndoableState } from '#/lib/hooks/useUndoableState'
import { useUndoRedoShortcuts } from '#/lib/hooks/useUndoRedoShortcuts'
import { PageHeader } from '#/components/admin/PageHeader'
import { TagsInput } from '#/components/admin/TagsInput'
import { UndoRedoButtons } from '#/components/admin/UndoRedoButtons'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'
import type { ProductStatus } from '#/types/entities'

const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const
type FillField = 'pricePesos' | 'costPesos' | 'qty'
const FILL_ROW_ATTR = 'data-fill-row-index'

export const Route = createFileRoute('/admin/products/bulk-edit')({
  validateSearch: z.object({ ids: z.string() }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const ids = deps.ids.split(',').filter(Boolean)
    const [products, collections] = await Promise.all([
      getProductsByIds({ data: { ids } }),
      listAllCollections(),
    ])
    return { products, collections }
  },
  component: BulkEditPage,
})

interface ProductEdit {
  name: string
  status: ProductStatus
  tags: string[]
  collectionIds: string[]
}

interface VariantEdit {
  productId: string
  sku: string
  size: string
  pricePesos: number
  costPesos: number | ''
  qty: number
}

interface DragState {
  field: FillField
  startIndex: number
  currentIndex: number
}

interface BulkEditFormState {
  productEdits: Record<string, ProductEdit>
  variantEdits: Record<string, VariantEdit>
}

function BulkEditPage() {
  const { products, collections } = Route.useLoaderData()
  const navigate = useNavigate()

  const flatVariantIds = useMemo(
    () => products.flatMap((p) => p.variants.map((v) => v.id)),
    [products],
  )

  const {
    value: form,
    set: setForm,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useUndoableState<BulkEditFormState>({
    productEdits: Object.fromEntries(
      products.map((p) => [
        p.id,
        {
          name: p.name,
          status: p.status,
          tags: p.tags,
          collectionIds: p.collections.map((c) => c.collection_id),
        },
      ]),
    ),
    variantEdits: Object.fromEntries(
      products.flatMap((p) =>
        p.variants.map((v) => [
          v.id,
          {
            productId: p.id,
            sku: v.sku,
            size: v.size ?? '',
            pricePesos: centsToPesos(v.price_cents),
            costPesos: v.cost_cents !== null ? centsToPesos(v.cost_cents) : '',
            qty: v.inventory[0]?.quantity_on_hand ?? 0,
          },
        ]),
      ),
    ),
  })
  useUndoRedoShortcuts(undo, redo)

  const { productEdits, variantEdits } = form

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)

  useEffect(() => {
    if (!drag) return

    function handleMouseMove(event: MouseEvent) {
      const el = document.elementFromPoint(event.clientX, event.clientY)
      const rowEl = el?.closest(`[${FILL_ROW_ATTR}]`)
      if (!rowEl) return
      const index = Number(rowEl.getAttribute(FILL_ROW_ATTR))
      setDrag((prev) => (prev ? { ...prev, currentIndex: index } : prev))
    }

    function handleMouseUp() {
      setDrag((prev) => {
        if (prev) applyFill(prev.field, prev.startIndex, prev.currentIndex)
        return null
      })
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [drag !== null])

  function applyFill(field: FillField, startIndex: number, endIndex: number) {
    const lo = Math.min(startIndex, endIndex)
    const hi = Math.max(startIndex, endIndex)
    const sourceId = flatVariantIds[startIndex]
    const sourceValue = variantEdits[sourceId][field]
    const nextVariantEdits = { ...variantEdits }
    for (let i = lo; i <= hi; i++) {
      const id = flatVariantIds[i]
      nextVariantEdits[id] = { ...nextVariantEdits[id], [field]: sourceValue }
    }
    setForm({ ...form, variantEdits: nextVariantEdits })
  }

  function updateProductEdit(productId: string, patch: Partial<ProductEdit>) {
    setForm({
      ...form,
      productEdits: {
        ...productEdits,
        [productId]: { ...productEdits[productId], ...patch },
      },
    })
  }

  function updateVariantEdit(variantId: string, patch: Partial<VariantEdit>) {
    setForm({
      ...form,
      variantEdits: {
        ...variantEdits,
        [variantId]: { ...variantEdits[variantId], ...patch },
      },
    })
  }

  async function handleSave() {
    setSubmitting(true)
    setError(null)
    setSaved(false)
    try {
      await Promise.all([
        ...products.map(async (original) => {
          const edit = productEdits[original.id]
          if (
            edit.name !== original.name ||
            edit.status !== original.status ||
            JSON.stringify(edit.tags) !== JSON.stringify(original.tags)
          ) {
            await updateProduct({
              data: {
                id: original.id,
                slug: original.slug,
                name: edit.name,
                description: original.description ?? undefined,
                productType: original.product_type,
                status: edit.status,
                images: original.images,
                tags: edit.tags,
                seoTitle: original.seo_title ?? undefined,
                seoDescription: original.seo_description ?? undefined,
              },
            })
          }

          const originalCollectionIds = original.collections
            .map((c) => c.collection_id)
            .sort()
          const editCollectionIds = [...edit.collectionIds].sort()
          if (
            JSON.stringify(originalCollectionIds) !==
            JSON.stringify(editCollectionIds)
          ) {
            await setProductCollections({
              data: {
                productId: original.id,
                collectionIds: edit.collectionIds,
              },
            })
          }
        }),
        ...products.flatMap((product) =>
          product.variants.map(async (original) => {
            const edit = variantEdits[original.id]
            const originalQty = original.inventory[0]?.quantity_on_hand ?? 0

            if (
              edit.pricePesos !== centsToPesos(original.price_cents) ||
              edit.costPesos !==
                (original.cost_cents !== null
                  ? centsToPesos(original.cost_cents)
                  : '') ||
              edit.size !== (original.size ?? '') ||
              edit.sku !== original.sku
            ) {
              await updateVariant({
                data: {
                  id: original.id,
                  productId: original.product_id,
                  sku: edit.sku,
                  size: edit.size || undefined,
                  color: original.color ?? undefined,
                  style: original.style ?? undefined,
                  pricePesos: edit.pricePesos,
                  costPesos: edit.costPesos === '' ? undefined : edit.costPesos,
                  isActive: original.is_active,
                },
              })
            }

            if (edit.qty !== originalQty) {
              await adjustInventory({
                data: {
                  variantId: original.id,
                  quantityDelta: edit.qty - originalQty,
                },
              })
            }
          }),
        ),
      ])
      setSaved(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  let variantRowIndex = -1

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title={`Editing ${products.length} ${products.length === 1 ? 'product' : 'products'}`}
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
              onClick={() => navigate({ to: '/admin/products' })}
              className={buttonSecondaryClassName}
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={submitting}
              className={buttonPrimaryClassName}
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        }
      />
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      <p className="mb-3 text-xs text-neutral-500">
        Tip: drag the small square at the corner of a Price, Available qty, or
        Cost box down to copy it into the rows below — like a spreadsheet fill
        handle.
      </p>

      <div className={tableWrapperClassName}>
        <div className="overflow-x-auto">
          <table className="w-full select-none">
            <thead>
              <tr>
                <th className={tableHeadClassName}>Product / Variant</th>
                <th className={tableHeadClassName}>SKU</th>
                <th className={tableHeadClassName}>Status</th>
                <th className={tableHeadClassName}>Collections</th>
                <th className={tableHeadClassName}>Tags</th>
                <th className={tableHeadClassName}>Price</th>
                <th className={tableHeadClassName}>Available qty</th>
                <th className={tableHeadClassName}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const edit = productEdits[product.id]
                return (
                  <Fragment key={product.id}>
                    <tr className="border-t border-neutral-200 bg-neutral-50">
                      <td className={tableCellClassName}>
                        <div className="flex items-center gap-3">
                          {product.images[0] ? (
                            <img
                              src={product.images[0]}
                              alt=""
                              className="size-8 rounded-md border border-neutral-200 object-cover"
                            />
                          ) : (
                            <div className="flex size-8 items-center justify-center rounded-md border border-neutral-200 bg-white">
                              <Package size={14} className="text-neutral-300" />
                            </div>
                          )}
                          <input
                            value={edit.name}
                            onChange={(e) =>
                              updateProductEdit(product.id, {
                                name: e.target.value,
                              })
                            }
                            className={`${inputClassName} min-w-48 font-medium`}
                          />
                        </div>
                      </td>
                      <td className={tableCellClassName} />
                      <td className={tableCellClassName}>
                        <select
                          value={edit.status}
                          onChange={(e) =>
                            updateProductEdit(product.id, {
                              status: e.target.value as ProductStatus,
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
                      </td>
                      <td className={tableCellClassName}>
                        <CollectionsCell
                          allCollections={collections}
                          selectedIds={edit.collectionIds}
                          onChange={(collectionIds) =>
                            updateProductEdit(product.id, { collectionIds })
                          }
                        />
                      </td>
                      <td className={tableCellClassName}>
                        <TagsInput
                          tags={edit.tags}
                          onChange={(tags) =>
                            updateProductEdit(product.id, { tags })
                          }
                        />
                      </td>
                      <td className={tableCellClassName} colSpan={3} />
                    </tr>
                    {product.variants.map((variant) => {
                      const vEdit = variantEdits[variant.id]
                      variantRowIndex += 1
                      const rowIndex = variantRowIndex
                      const inRange = (field: FillField) =>
                        drag !== null &&
                        drag.field === field &&
                        rowIndex >=
                          Math.min(drag.startIndex, drag.currentIndex) &&
                        rowIndex <= Math.max(drag.startIndex, drag.currentIndex)

                      return (
                        <tr
                          key={variant.id}
                          {...{ [FILL_ROW_ATTR]: rowIndex }}
                          className={tableRowClassName}
                        >
                          <td className={`${tableCellClassName} pl-10`}>
                            <input
                              value={vEdit.size}
                              onChange={(e) =>
                                updateVariantEdit(variant.id, {
                                  size: e.target.value,
                                })
                              }
                              placeholder="Size"
                              className={`${inputClassName} w-20`}
                            />
                          </td>
                          <td className={tableCellClassName}>
                            <input
                              value={vEdit.sku}
                              onChange={(e) =>
                                updateVariantEdit(variant.id, {
                                  sku: e.target.value,
                                })
                              }
                              placeholder="SKU"
                              className={`${inputClassName} w-28`}
                            />
                          </td>
                          <td className={tableCellClassName} colSpan={2} />
                          <td className={tableCellClassName} />
                          <td
                            className={`${tableCellClassName} ${inRange('pricePesos') ? 'bg-blue-50' : ''}`}
                          >
                            <div className="relative inline-flex items-center gap-1">
                              <span className="text-neutral-400">₱</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={vEdit.pricePesos}
                                onChange={(e) =>
                                  updateVariantEdit(variant.id, {
                                    pricePesos: Number(e.target.value),
                                  })
                                }
                                className={`${inputClassName} w-24`}
                              />
                              <FillHandle
                                onStart={() =>
                                  setDrag({
                                    field: 'pricePesos',
                                    startIndex: rowIndex,
                                    currentIndex: rowIndex,
                                  })
                                }
                              />
                            </div>
                          </td>
                          <td
                            className={`${tableCellClassName} ${inRange('qty') ? 'bg-blue-50' : ''}`}
                          >
                            <div className="relative inline-block">
                              <input
                                type="number"
                                min="0"
                                value={vEdit.qty}
                                onChange={(e) =>
                                  updateVariantEdit(variant.id, {
                                    qty: Number(e.target.value),
                                  })
                                }
                                className={`${inputClassName} w-20`}
                              />
                              <FillHandle
                                onStart={() =>
                                  setDrag({
                                    field: 'qty',
                                    startIndex: rowIndex,
                                    currentIndex: rowIndex,
                                  })
                                }
                              />
                            </div>
                          </td>
                          <td
                            className={`${tableCellClassName} ${inRange('costPesos') ? 'bg-blue-50' : ''}`}
                          >
                            <div className="relative inline-flex items-center gap-1">
                              <span className="text-neutral-400">₱</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={vEdit.costPesos}
                                onChange={(e) =>
                                  updateVariantEdit(variant.id, {
                                    costPesos:
                                      e.target.value === ''
                                        ? ''
                                        : Number(e.target.value),
                                  })
                                }
                                className={`${inputClassName} w-24`}
                              />
                              <FillHandle
                                onStart={() =>
                                  setDrag({
                                    field: 'costPesos',
                                    startIndex: rowIndex,
                                    currentIndex: rowIndex,
                                  })
                                }
                              />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function FillHandle({ onStart }: { onStart: () => void }) {
  return (
    <span
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onStart()
      }}
      className="absolute -right-1 -bottom-1 size-2.5 cursor-crosshair rounded-[2px] border border-white bg-blue-600"
    />
  )
}

function CollectionsCell({
  allCollections,
  selectedIds,
  onChange,
}: {
  allCollections: { id: string; name: string }[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)

  function toggle(id: string) {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((c) => c !== id)
        : [...selectedIds, id],
    )
  }

  const label =
    selectedIds.length === 0
      ? 'No collections'
      : allCollections
          .filter((c) => selectedIds.includes(c.id))
          .map((c) => c.name)
          .join(', ')

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${inputClassName} flex w-full min-w-40 items-center justify-between gap-2 text-left`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={14} className="shrink-0 text-neutral-400" />
      </button>
      {open && (
        <div className="absolute top-full left-0 z-10 mt-1 max-h-56 w-56 overflow-y-auto rounded-md border border-neutral-200 bg-white p-2 shadow-lg">
          {allCollections.map((collection) => (
            <label
              key={collection.id}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(collection.id)}
                onChange={() => toggle(collection.id)}
              />
              {collection.name}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

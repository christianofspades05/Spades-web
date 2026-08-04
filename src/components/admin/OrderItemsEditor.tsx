import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { updateOrderItems } from '#/server/admin/orders'
import type { OrderWithDetails } from '#/server/admin/orders'
import {
  getVariantsForOrderEdit,
  searchProductsForPicker,
} from '#/server/admin/products'
import type {
  OrderEditVariantOption,
  ProductPickerResult,
} from '#/server/admin/products'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { getErrorMessage } from '#/lib/utils/errors'
import { Card } from '#/components/admin/Card'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  inputClassName,
} from '#/components/admin/ui'

interface DraftLine {
  /** Existing order_item id, or null for a line just added in this session. */
  id: string | null
  productId: string
  productName: string
  variantId: string
  variantLabel: string
  quantity: number
  /** Display-only estimate — the server recalculates the real snapshot
   *  price on save (today's catalog price for a new/swapped line, the
   *  original charged price for a pure quantity edit — see
   *  updateOrderItems in src/server/admin/orders.ts). */
  priceCents: number
}

function draftLinesFromOrder(order: OrderWithDetails): DraftLine[] {
  return order.order_items
    .filter((item) => item.variant_id !== null && item.product_id !== null)
    .map((item) => ({
      id: item.id,
      productId: item.product_id as string,
      productName: item.product_name_snapshot,
      variantId: item.variant_id as string,
      variantLabel: item.variant_label_snapshot ?? 'Default',
      quantity: item.quantity,
      priceCents: item.unit_price_cents,
    }))
}

/** The parent page (src/routes/admin/orders/$orderId.tsx) owns whether this
 *  is rendered at all — it needs to know when editing is active so it can
 *  hide its own read-only item list, so the edit/view toggle isn't managed
 *  internally here. */
export function OrderItemsEditor({
  order,
  onCancel,
  onSaved,
}: {
  order: OrderWithDetails
  onCancel: () => void
  onSaved: () => void
}) {
  const [draftLines, setDraftLines] = useState<DraftLine[]>(() =>
    draftLinesFromOrder(order),
  )
  const [variantOptions, setVariantOptions] = useState<
    Map<string, OrderEditVariantOption[]>
  >(new Map())
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The "add item" sub-flow: search -> pick a product -> pick a size/variant
  // and quantity -> append to draftLines.
  const [pickedProduct, setPickedProduct] = useState<ProductPickerResult | null>(
    null,
  )
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerResults, setPickerResults] = useState<ProductPickerResult[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [newVariantId, setNewVariantId] = useState('')
  const [newQuantity, setNewQuantity] = useState(1)

  const readOnlyLines = order.order_items.filter(
    (item) => item.variant_id === null || item.product_id === null,
  )

  async function fetchVariantsFor(productId: string) {
    if (variantOptions.has(productId)) return
    const options = await getVariantsForOrderEdit({ data: { productId } })
    setVariantOptions((prev) => new Map(prev).set(productId, options))
  }

  // Only runs once, for the lines the order started with — lines added
  // later via addPickedLine already fetch their own variants on pick.
  useEffect(() => {
    Array.from(new Set(draftLines.map((l) => l.productId))).forEach(
      fetchVariantsFor,
    )
  }, [])

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setDraftLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    )
  }

  function handleVariantChange(index: number, variantId: string) {
    const line = draftLines[index]
    const options = variantOptions.get(line.productId) ?? []
    const option = options.find((o) => o.id === variantId)
    if (!option) return
    updateLine(index, {
      variantId: option.id,
      variantLabel: option.label,
      priceCents: option.priceCents,
    })
  }

  function removeLine(index: number) {
    if (draftLines.length <= 1) return
    setDraftLines((prev) => prev.filter((_, i) => i !== index))
  }

  async function handlePickerSearch(event: React.FormEvent) {
    event.preventDefault()
    setPickerLoading(true)
    try {
      const found = await searchProductsForPicker({
        data: { q: pickerQuery || undefined },
      })
      setPickerResults(found)
    } finally {
      setPickerLoading(false)
    }
  }

  async function handlePickProduct(product: ProductPickerResult) {
    setPickedProduct(product)
    setPickerResults([])
    setNewVariantId('')
    setNewQuantity(1)
    await fetchVariantsFor(product.id)
  }

  function addPickedLine() {
    if (!pickedProduct || !newVariantId) return
    const options = variantOptions.get(pickedProduct.id) ?? []
    const option = options.find((o) => o.id === newVariantId)
    if (!option) return
    setDraftLines((prev) => [
      ...prev,
      {
        id: null,
        productId: pickedProduct.id,
        productName: pickedProduct.name,
        variantId: option.id,
        variantLabel: option.label,
        quantity: newQuantity,
        priceCents: option.priceCents,
      },
    ])
    setPickedProduct(null)
    setNewVariantId('')
    setNewQuantity(1)
  }

  async function handleSave() {
    setSubmitting(true)
    setError(null)
    try {
      await updateOrderItems({
        data: {
          orderId: order.id,
          items: draftLines.map((line) => ({
            id: line.id,
            variantId: line.variantId,
            quantity: line.quantity,
          })),
        },
      })
      onSaved()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const estimatedSubtotalCents = draftLines.reduce(
    (sum, line) => sum + line.priceCents * line.quantity,
    0,
  )

  return (
    <div className="flex flex-col gap-4">
      {readOnlyLines.length > 0 && (
        <p className="text-xs text-neutral-500">
          {readOnlyLines.length} item(s) on this order can't be edited — their
          product has since been removed from the catalog.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {draftLines.map((line, index) => {
          const options = variantOptions.get(line.productId) ?? []
          return (
            <li
              key={index}
              className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 p-2"
            >
              <span className="min-w-32 flex-1 text-sm font-medium text-neutral-900">
                {line.productName}
              </span>
              <select
                value={line.variantId}
                onChange={(e) => handleVariantChange(index, e.target.value)}
                className={`${inputClassName} w-40`}
              >
                {options.length === 0 && (
                  <option value={line.variantId}>{line.variantLabel}</option>
                )}
                {options.map((o) => (
                  <option key={o.id} value={o.id} disabled={!o.isActive}>
                    {o.label}
                    {!o.isActive ? ' (inactive)' : ''} — {o.quantityAvailable}{' '}
                    in stock
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={999}
                value={line.quantity}
                onChange={(e) =>
                  updateLine(index, {
                    quantity: Math.max(1, Number(e.target.value)),
                  })
                }
                className={`${inputClassName} w-20`}
              />
              <span className="w-24 text-right text-sm text-neutral-500">
                {formatCentsAsPHP(line.priceCents * line.quantity)}
              </span>
              <button
                type="button"
                onClick={() => removeLine(index)}
                disabled={draftLines.length <= 1}
                className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                title={
                  draftLines.length <= 1
                    ? "An order must have at least one item — use \"Cancel order\" instead"
                    : 'Remove this item'
                }
              >
                <X size={14} />
              </button>
            </li>
          )
        })}
      </ul>

      <div className="rounded-md border border-neutral-200 p-3">
        <p className="mb-2 text-xs font-medium text-neutral-500 uppercase">
          Add an item
        </p>
        {!pickedProduct ? (
          <form onSubmit={handlePickerSearch} className="flex gap-2">
            <input
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder="Search products to add"
              className={`${inputClassName} flex-1`}
            />
            <button type="submit" className={buttonSecondaryClassName}>
              {pickerLoading ? 'Searching…' : 'Search'}
            </button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-32 flex-1 text-sm font-medium text-neutral-900">
              {pickedProduct.name}
            </span>
            <select
              value={newVariantId}
              onChange={(e) => setNewVariantId(e.target.value)}
              className={`${inputClassName} w-40`}
            >
              <option value="">Pick a size…</option>
              {(variantOptions.get(pickedProduct.id) ?? []).map((o) => (
                <option key={o.id} value={o.id} disabled={!o.isActive}>
                  {o.label}
                  {!o.isActive ? ' (inactive)' : ''} — {o.quantityAvailable} in
                  stock
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={999}
              value={newQuantity}
              onChange={(e) =>
                setNewQuantity(Math.max(1, Number(e.target.value)))
              }
              className={`${inputClassName} w-20`}
            />
            <button
              type="button"
              disabled={!newVariantId}
              onClick={addPickedLine}
              className={buttonSecondaryClassName}
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setPickedProduct(null)}
              className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            >
              <X size={14} />
            </button>
          </div>
        )}
        {pickerResults.length > 0 && (
          <Card className="mt-2 p-2">
            <ul>
              {pickerResults.map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => handlePickProduct(product)}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-neutral-50"
                  >
                    {product.image && (
                      <img
                        src={product.image}
                        alt=""
                        className="size-8 rounded-md border border-neutral-200 object-cover"
                      />
                    )}
                    {product.name}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <div className="flex items-center justify-between text-sm text-neutral-500">
        <span>Estimated subtotal: {formatCentsAsPHP(estimatedSubtotalCents)}</span>
        <span>
          Subtotal, discount, and shipping will be recalculated when you save.
        </span>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!confirming ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={buttonPrimaryClassName}
          >
            Save changes
          </button>
          <button
            type="button"
            onClick={onCancel}
            className={buttonSecondaryClassName}
          >
            Never mind
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            This will update inventory and the order total. Any new or
            swapped-in items are charged at today's price. Continue?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={handleSave}
              className={buttonPrimaryClassName}
            >
              {submitting ? 'Saving…' : 'Confirm and save'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={buttonSecondaryClassName}
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

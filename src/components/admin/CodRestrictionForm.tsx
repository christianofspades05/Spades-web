import { useState } from 'react'
import { getErrorMessage } from '#/lib/utils/errors'
import type { CodRestrictionInput } from '#/lib/validation/admin/cod-restrictions'
import { Card } from '#/components/admin/Card'
import { ProductPicker } from '#/components/admin/ProductPicker'
import type { PickedProduct } from '#/components/admin/ProductPicker'
import {
  buttonPrimaryClassName,
  inputClassName,
  labelClassName,
} from '#/components/admin/ui'
import type { CodRestriction, Collection } from '#/types/entities'

export function CodRestrictionForm({
  restriction,
  collections,
  initialSelectedProducts,
  onSubmit,
  submitLabel,
}: {
  restriction?: CodRestriction
  collections: Collection[]
  initialSelectedProducts: PickedProduct[]
  onSubmit: (data: CodRestrictionInput) => Promise<void>
  submitLabel: string
}) {
  const [title, setTitle] = useState(restriction?.title ?? '')
  const [scope, setScope] = useState<'collection' | 'product'>(
    restriction?.scope ?? 'collection',
  )
  const [collectionIds, setCollectionIds] = useState<string[]>(
    restriction?.scope === 'collection' ? restriction.scope_ids : [],
  )
  const [selectedProducts, setSelectedProducts] = useState<PickedProduct[]>(
    restriction?.scope === 'product' ? initialSelectedProducts : [],
  )
  const [isActive, setIsActive] = useState(restriction?.is_active ?? true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function toggleCollection(id: string) {
    setCollectionIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    )
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        title,
        scope,
        scopeIds:
          scope === 'collection'
            ? collectionIds
            : selectedProducts.map((p) => p.id),
        isActive,
      })
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className={labelClassName}>
          Title
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Clearance Sale — no COD"
            className={inputClassName}
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-neutral-700">
            Hide Cash on Delivery for
          </legend>
          <label className="flex items-start gap-2 text-sm text-neutral-700">
            <input
              type="radio"
              name="scope"
              checked={scope === 'collection'}
              onChange={() => setScope('collection')}
              className="mt-1"
            />
            <span>
              <span className="font-medium text-neutral-900">A collection</span>{' '}
              — e.g. everything in "Clearance Sale".
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-neutral-700">
            <input
              type="radio"
              name="scope"
              checked={scope === 'product'}
              onChange={() => setScope('product')}
              className="mt-1"
            />
            <span>
              <span className="font-medium text-neutral-900">
                Specific products
              </span>
            </span>
          </label>
        </fieldset>

        {scope === 'collection' && (
          <fieldset className="flex flex-col gap-1 rounded-lg border border-neutral-200 p-4">
            <legend className="mb-1 text-sm font-medium text-neutral-900">
              Collections
            </legend>
            {collections.length === 0 ? (
              <p className="text-sm text-neutral-500">
                No collections yet — create one first.
              </p>
            ) : (
              collections.map((collection) => (
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
              ))
            )}
          </fieldset>
        )}

        {scope === 'product' && (
          <div className="rounded-lg border border-neutral-200 p-4">
            <p className="mb-3 text-sm font-medium text-neutral-900">
              Products
            </p>
            <ProductPicker
              selected={selectedProducts}
              onAdd={(product) =>
                setSelectedProducts((prev) => [
                  ...prev,
                  { id: product.id, name: product.name, image: product.image },
                ])
              }
              onRemove={(productId) =>
                setSelectedProducts((prev) =>
                  prev.filter((p) => p.id !== productId),
                )
              }
            />
          </div>
        )}

        <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Active
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className={buttonPrimaryClassName}
        >
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </form>
    </Card>
  )
}

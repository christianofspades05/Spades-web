import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { listAllCollections } from '#/server/admin/collections'
import { getProductsByIds } from '#/server/admin/products'
import {
  getCodRestrictionById,
  updateCodRestriction,
} from '#/server/admin/cod-restrictions'
import { PageHeader } from '#/components/admin/PageHeader'
import { CodRestrictionForm } from '#/components/admin/CodRestrictionForm'
import type { CodRestrictionInput } from '#/lib/validation/admin/cod-restrictions'

export const Route = createFileRoute('/admin/hide-payments/$restrictionId')({
  loader: async ({ params }) => {
    const [restriction, collections] = await Promise.all([
      getCodRestrictionById({ data: { id: params.restrictionId } }),
      listAllCollections(),
    ])
    if (!restriction) throw notFound()

    const initialSelectedProducts =
      restriction.scope === 'product' && restriction.scope_ids.length > 0
        ? await getProductsByIds({ data: { ids: restriction.scope_ids } })
        : []

    return {
      restriction,
      collections,
      initialSelectedProducts: initialSelectedProducts.map((p) => ({
        id: p.id,
        name: p.name,
        image: p.images[0] ?? null,
      })),
    }
  },
  component: EditCodRestrictionPage,
})

function EditCodRestrictionPage() {
  const { restriction, collections, initialSelectedProducts } =
    Route.useLoaderData()
  const navigate = useNavigate()

  async function handleSubmit(data: CodRestrictionInput) {
    await updateCodRestriction({ data: { ...data, id: restriction.id } })
    await navigate({ to: '/admin/hide-payments' })
  }

  return (
    <div className="w-full max-w-2xl px-8 py-10">
      <PageHeader title={`Edit ${restriction.title}`} />
      <CodRestrictionForm
        restriction={restriction}
        collections={collections.filter((c) => c.is_active)}
        initialSelectedProducts={initialSelectedProducts}
        onSubmit={handleSubmit}
        submitLabel="Save changes"
      />
    </div>
  )
}

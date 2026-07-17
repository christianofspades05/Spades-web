import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { listAllCollections } from '#/server/admin/collections'
import { createCodRestriction } from '#/server/admin/cod-restrictions'
import { PageHeader } from '#/components/admin/PageHeader'
import { CodRestrictionForm } from '#/components/admin/CodRestrictionForm'
import type { CodRestrictionInput } from '#/lib/validation/admin/cod-restrictions'

export const Route = createFileRoute('/admin/hide-payments/new')({
  loader: () => listAllCollections(),
  component: NewCodRestrictionPage,
})

function NewCodRestrictionPage() {
  const collections = Route.useLoaderData()
  const navigate = useNavigate()

  async function handleSubmit(data: CodRestrictionInput) {
    const restriction = await createCodRestriction({ data })
    await navigate({
      to: '/admin/hide-payments/$restrictionId',
      params: { restrictionId: restriction.id },
    })
  }

  return (
    <div className="w-full max-w-2xl px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader title="Hide Cash on Delivery" />
      <CodRestrictionForm
        collections={collections.filter((c) => c.is_active)}
        initialSelectedProducts={[]}
        onSubmit={handleSubmit}
        submitLabel="Create restriction"
      />
    </div>
  )
}

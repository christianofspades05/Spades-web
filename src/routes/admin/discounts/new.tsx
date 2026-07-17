import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { listAllCollections } from '#/server/admin/collections'
import { createDiscount } from '#/server/admin/discounts'
import { PageHeader } from '#/components/admin/PageHeader'
import { DiscountForm } from '#/components/admin/DiscountForm'
import type { DiscountInput } from '#/lib/validation/admin/discounts'

export const Route = createFileRoute('/admin/discounts/new')({
  loader: () => listAllCollections(),
  component: NewDiscountPage,
})

function NewDiscountPage() {
  const collections = Route.useLoaderData()
  const navigate = useNavigate()

  async function handleSubmit(data: DiscountInput) {
    const discount = await createDiscount({ data })
    await navigate({
      to: '/admin/discounts/$discountId',
      params: { discountId: discount.id },
    })
  }

  return (
    <div className="w-full max-w-2xl px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader title="Create discount" />
      <DiscountForm
        collections={collections.filter((c) => c.is_active)}
        lockKind={false}
        onSubmit={handleSubmit}
        submitLabel="Create discount"
      />
    </div>
  )
}

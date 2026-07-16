import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { listAllCollections } from '#/server/admin/collections'
import { getDiscountById, updateDiscount } from '#/server/admin/discounts'
import { PageHeader } from '#/components/admin/PageHeader'
import { DiscountForm } from '#/components/admin/DiscountForm'
import type { DiscountInput } from '#/lib/validation/admin/discounts'

export const Route = createFileRoute('/admin/discounts/$discountId')({
  loader: async ({ params }) => {
    const [discount, collections] = await Promise.all([
      getDiscountById({ data: { id: params.discountId } }),
      listAllCollections(),
    ])
    if (!discount) throw notFound()
    return { discount, collections }
  },
  component: EditDiscountPage,
})

function EditDiscountPage() {
  const { discount, collections } = Route.useLoaderData()
  const navigate = useNavigate()

  async function handleSubmit(data: DiscountInput) {
    await updateDiscount({ data: { ...data, id: discount.id } })
    await navigate({ to: '/admin/discounts' })
  }

  return (
    <div className="w-full max-w-2xl px-8 py-10">
      <PageHeader title={`Edit ${discount.title}`} />
      <DiscountForm
        discount={discount}
        collections={collections.filter((c) => c.is_active)}
        lockKind
        onSubmit={handleSubmit}
        submitLabel="Save changes"
      />
    </div>
  )
}

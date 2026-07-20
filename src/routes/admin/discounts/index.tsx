import { createFileRoute, Link } from '@tanstack/react-router'
import { listAllDiscounts } from '#/server/admin/discounts'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { PageHeader } from '#/components/admin/PageHeader'
import { Badge } from '#/components/admin/Badge'
import {
  buttonPrimaryClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'
import type { Discount } from '#/types/entities'

export const Route = createFileRoute('/admin/discounts/')({
  loader: () => listAllDiscounts(),
  component: DiscountsPage,
})

type DiscountStatus = 'active' | 'scheduled' | 'expired' | 'inactive'

function computeStatus(d: Discount): DiscountStatus {
  if (!d.is_active) return 'inactive'
  const now = new Date()
  if (d.starts_at && new Date(d.starts_at) > now) return 'scheduled'
  if (d.ends_at && new Date(d.ends_at) < now) return 'expired'
  if (d.max_uses !== null && d.times_used >= d.max_uses) return 'expired'
  return 'active'
}

const STATUS_TONE: Record<
  DiscountStatus,
  'success' | 'info' | 'critical' | 'neutral'
> = {
  active: 'success',
  scheduled: 'info',
  expired: 'critical',
  inactive: 'neutral',
}

function valueLabel(d: Discount): string {
  return d.type === 'percentage'
    ? `${d.value}% off`
    : `${formatCentsAsPHP(d.value)} off`
}

function DiscountsPage() {
  const discounts = Route.useLoaderData()

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Discounts"
        subtitle={`${discounts.length} ${discounts.length === 1 ? 'discount' : 'discounts'}`}
        action={
          <Link to="/admin/discounts/new" className={buttonPrimaryClassName}>
            Create discount
          </Link>
        }
      />

      <div className={tableWrapperClassName}>
        {discounts.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">
            No discounts yet. Create a discount code customers can enter at
            checkout, or a store sale that applies automatically.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClassName}>Title</th>
                  <th className={tableHeadClassName}>Status</th>
                  <th className={tableHeadClassName}>Method</th>
                  <th className={tableHeadClassName}>Value</th>
                  <th className={tableHeadClassName}>Collections</th>
                  <th className={`${tableHeadClassName} text-right`}>Used</th>
                </tr>
              </thead>
              <tbody>
                {discounts.map((discount) => {
                  const status = computeStatus(discount)
                  return (
                    <tr key={discount.id} className={tableRowClassName}>
                      <td className={tableCellClassName}>
                        <Link
                          to="/admin/discounts/$discountId"
                          params={{ discountId: discount.id }}
                          className="font-medium text-neutral-900 hover:underline"
                        >
                          {discount.title}
                        </Link>
                        {discount.code && (
                          <p className="text-xs text-neutral-500">
                            {discount.code}
                          </p>
                        )}
                      </td>
                      <td className={tableCellClassName}>
                        <Badge tone={STATUS_TONE[status]}>{status}</Badge>
                      </td>
                      <td className={`${tableCellClassName} text-neutral-500`}>
                        {discount.kind === 'code'
                          ? 'Discount code'
                          : discount.scope === 'collection'
                            ? 'Collection sale'
                            : 'Store sale'}
                      </td>
                      <td className={`${tableCellClassName} text-neutral-500`}>
                        {valueLabel(discount)}
                      </td>
                      <td className={`${tableCellClassName} text-neutral-500`}>
                        {discount.scope === 'collection'
                          ? `${discount.scope_ids.length} included`
                          : discount.excluded_collection_ids.length > 0
                            ? `${discount.excluded_collection_ids.length} excluded`
                            : '—'}
                      </td>
                      <td className={`${tableCellClassName} text-right`}>
                        {discount.times_used}
                        {discount.max_uses !== null &&
                          ` / ${discount.max_uses}`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

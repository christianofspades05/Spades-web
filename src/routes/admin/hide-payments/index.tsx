import { createFileRoute, Link } from '@tanstack/react-router'
import { listCodRestrictions } from '#/server/admin/cod-restrictions'
import { PageHeader } from '#/components/admin/PageHeader'
import { Badge } from '#/components/admin/Badge'
import {
  buttonPrimaryClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

export const Route = createFileRoute('/admin/hide-payments/')({
  loader: () => listCodRestrictions(),
  component: HidePaymentsPage,
})

function HidePaymentsPage() {
  const restrictions = Route.useLoaderData()

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Hide Payments"
        subtitle="Block Cash on Delivery for specific collections or products — e.g. a Clearance Sale that must be paid online."
        action={
          <Link
            to="/admin/hide-payments/new"
            className={buttonPrimaryClassName}
          >
            Create restriction
          </Link>
        }
      />

      <div className={tableWrapperClassName}>
        {restrictions.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">
            No restrictions yet. Cash on Delivery is available for every
            product.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClassName}>Title</th>
                  <th className={tableHeadClassName}>Status</th>
                  <th className={tableHeadClassName}>Applies to</th>
                  <th className={`${tableHeadClassName} text-right`}>Scope</th>
                </tr>
              </thead>
              <tbody>
                {restrictions.map((restriction) => (
                  <tr key={restriction.id} className={tableRowClassName}>
                    <td className={tableCellClassName}>
                      <Link
                        to="/admin/hide-payments/$restrictionId"
                        params={{ restrictionId: restriction.id }}
                        className="font-medium text-neutral-900 hover:underline"
                      >
                        {restriction.title}
                      </Link>
                    </td>
                    <td className={tableCellClassName}>
                      <Badge
                        tone={restriction.is_active ? 'success' : 'neutral'}
                      >
                        {restriction.is_active ? 'active' : 'inactive'}
                      </Badge>
                    </td>
                    <td className={`${tableCellClassName} text-neutral-500`}>
                      {restriction.scope === 'collection'
                        ? 'Collection'
                        : 'Specific products'}
                    </td>
                    <td
                      className={`${tableCellClassName} text-right text-neutral-500`}
                    >
                      {restriction.scope_ids.length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'
import {
  getEmailContactsCount,
  listEmailAutomations,
  listEmailContacts,
} from '#/server/admin/email-automations'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { PageHeader } from '#/components/admin/PageHeader'
import { Card } from '#/components/admin/Card'
import { Badge } from '#/components/admin/Badge'
import {
  buttonSecondaryClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'
import type { EmailAutomation } from '#/types/entities'

const CONTACTS_PAGE_SIZE = 100

const EVENT_TYPE_DESCRIPTIONS: Record<EmailAutomation['event_type'], string> = {
  welcome: 'Sent immediately when a customer creates an account.',
  abandoned_cart: 'Sent once a cart has been inactive for a while.',
  post_purchase_review: 'Sent some time after an order is delivered.',
  birthday: "Sent once a year, on the customer's birthday.",
}

export const Route = createFileRoute('/admin/email/')({
  validateSearch: z.object({
    q: z.string().optional(),
    onlineStoreOnly: z.boolean().catch(false),
    marketingOptInOnly: z.boolean().catch(false),
    page: z.number().int().min(1).catch(1),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const contactFilters = {
      q: deps.q,
      onlineStoreOnly: deps.onlineStoreOnly,
      marketingOptInOnly: deps.marketingOptInOnly,
    }
    const [automations, contacts, { total }] = await Promise.all([
      listEmailAutomations(),
      listEmailContacts({ data: { ...contactFilters, page: deps.page } }),
      getEmailContactsCount({ data: contactFilters }),
    ])
    return { automations, contacts, total }
  },
  component: EmailMarketingPage,
})

function EmailMarketingPage() {
  const { automations, contacts, total } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const [qInput, setQInput] = useState(search.q ?? '')

  const page = search.page
  const totalPages = Math.max(1, Math.ceil(total / CONTACTS_PAGE_SIZE))
  const rangeStartIndex = total === 0 ? 0 : (page - 1) * CONTACTS_PAGE_SIZE + 1
  const rangeEndIndex = Math.min(page * CONTACTS_PAGE_SIZE, total)

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault()
    navigate({
      search: (prev) => ({ ...prev, q: qInput || undefined, page: 1 }),
    })
  }

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Email"
        subtitle="Lifecycle automations and marketing contacts"
      />

      <p className="mb-3 text-xs font-semibold tracking-wider text-neutral-400 uppercase">
        Automations
      </p>
      <div className={`${tableWrapperClassName} mb-10`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={tableHeadClassName}>Automation</th>
                <th className={tableHeadClassName}>Status</th>
                <th className={tableHeadClassName}>Discount</th>
                <th className={tableHeadClassName}>Schedule</th>
                <th className={`${tableHeadClassName} text-right`}>Sends</th>
                <th className={`${tableHeadClassName} text-right`}>
                  Attributed revenue
                </th>
                <th className={`${tableHeadClassName} text-right`}>
                  Conv. rate
                </th>
              </tr>
            </thead>
            <tbody>
              {automations.map((automation) => (
                <tr key={automation.id} className={tableRowClassName}>
                  <td className={tableCellClassName}>
                    <Link
                      to="/admin/email/$automationId"
                      params={{ automationId: automation.id }}
                      className="font-medium text-neutral-900 hover:underline"
                    >
                      {automation.name}
                    </Link>
                    <p className="text-xs text-neutral-500">
                      {EVENT_TYPE_DESCRIPTIONS[automation.event_type]}
                    </p>
                  </td>
                  <td className={tableCellClassName}>
                    <Badge tone={automation.is_active ? 'success' : 'neutral'}>
                      {automation.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className={`${tableCellClassName} text-neutral-500`}>
                    {automation.discount_id ? 'Attached' : '—'}
                  </td>
                  <td className={`${tableCellClassName} text-neutral-500`}>
                    {automation.event_type === 'welcome'
                      ? 'Immediately'
                      : automation.event_type === 'birthday'
                        ? 'On birthday'
                        : automation.delay_hours % 24 === 0
                          ? `${automation.delay_hours / 24}d after`
                          : `${automation.delay_hours}h after`}
                  </td>
                  <td className={`${tableCellClassName} text-right`}>
                    {automation.totalSends}
                    {automation.totalSends > 0 && (
                      <span className="text-neutral-400">
                        {' '}
                        ({automation.sendsLast30Days} in 30d)
                      </span>
                    )}
                  </td>
                  <td className={`${tableCellClassName} text-right`}>
                    {automation.discount_id ? (
                      <>
                        {formatCentsAsPHP(automation.attributedRevenueCents)}
                        <span className="text-neutral-400">
                          {' '}
                          ({automation.attributedOrderCount}{' '}
                          {automation.attributedOrderCount === 1
                            ? 'order'
                            : 'orders'}
                          )
                        </span>
                      </>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                  <td className={`${tableCellClassName} text-right`}>
                    {automation.totalSends > 0 ? (
                      `${((automation.attributedOrderCount / automation.totalSends) * 100).toFixed(1)}%`
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold tracking-wider text-neutral-400 uppercase">
          Contacts
        </p>
        <span className="text-xs text-neutral-400">
          {total} {total === 1 ? 'contact' : 'contacts'}
        </span>
      </div>

      <Card className="mb-4 flex flex-wrap items-center gap-4 p-4">
        <form onSubmit={handleSearchSubmit} className="w-full max-w-xs">
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search name or email"
            className="w-full rounded-md border border-neutral-200 px-3 py-1.5 text-sm"
          />
        </form>
        <label className="flex items-center gap-1.5 text-sm text-neutral-600">
          <input
            type="checkbox"
            checked={search.onlineStoreOnly}
            onChange={(e) =>
              navigate({
                search: (prev) => ({
                  ...prev,
                  onlineStoreOnly: e.target.checked,
                  page: 1,
                }),
              })
            }
          />
          Online store only
        </label>
        <label className="flex items-center gap-1.5 text-sm text-neutral-600">
          <input
            type="checkbox"
            checked={search.marketingOptInOnly}
            onChange={(e) =>
              navigate({
                search: (prev) => ({
                  ...prev,
                  marketingOptInOnly: e.target.checked,
                  page: 1,
                }),
              })
            }
          />
          Opted in to marketing only
        </label>
      </Card>

      <div className={tableWrapperClassName}>
        {contacts.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">No contacts match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClassName}>Name</th>
                  <th className={tableHeadClassName}>Email</th>
                  <th className={tableHeadClassName}>Account</th>
                  <th className={tableHeadClassName}>Marketing</th>
                  <th className={`${tableHeadClassName} text-right`}>Orders</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr key={contact.id} className={tableRowClassName}>
                    <td className={tableCellClassName}>
                      {contact.full_name ?? '—'}
                    </td>
                    <td className={`${tableCellClassName} text-neutral-500`}>
                      {contact.email}
                    </td>
                    <td className={tableCellClassName}>
                      <Badge tone={contact.auth_user_id ? 'info' : 'neutral'}>
                        {contact.auth_user_id ? 'Online store' : 'Guest'}
                      </Badge>
                    </td>
                    <td className={tableCellClassName}>
                      <Badge
                        tone={contact.marketing_opt_in ? 'success' : 'neutral'}
                      >
                        {contact.marketing_opt_in ? 'Opted in' : 'Opted out'}
                      </Badge>
                    </td>
                    <td className={`${tableCellClassName} text-right`}>
                      {contact.successful_orders_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-500">
          <p>
            Showing {rangeStartIndex}–{rangeEndIndex} of {total}
          </p>
          <div className="flex items-center gap-3">
            <Link
              to="/admin/email"
              from={Route.fullPath}
              search={(prev) => ({ ...prev, page: page - 1 })}
              aria-disabled={page <= 1}
              className={`${buttonSecondaryClassName} ${page <= 1 ? 'pointer-events-none opacity-40' : ''}`}
            >
              Previous
            </Link>
            <span className="text-xs text-neutral-400">
              Page {page} of {totalPages}
            </span>
            <Link
              to="/admin/email"
              from={Route.fullPath}
              search={(prev) => ({ ...prev, page: page + 1 })}
              aria-disabled={page >= totalPages}
              className={`${buttonSecondaryClassName} ${page >= totalPages ? 'pointer-events-none opacity-40' : ''}`}
            >
              Next
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

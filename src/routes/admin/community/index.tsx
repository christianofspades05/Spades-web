import { z } from 'zod'
import { createFileRoute, Link } from '@tanstack/react-router'
import { getEventsCount, listEvents } from '#/server/admin/events'
import { formatCentsAsPHP } from '#/lib/utils/money'
import { PageHeader } from '#/components/admin/PageHeader'
import { Badge } from '#/components/admin/Badge'
import {
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  tableCellClassName,
  tableHeadClassName,
  tableRowClassName,
  tableWrapperClassName,
} from '#/components/admin/ui'

const PAGE_SIZE = 20

export const Route = createFileRoute('/admin/community/')({
  validateSearch: z.object({
    page: z.number().int().min(1).catch(1),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const [events, { total }] = await Promise.all([
      listEvents({ data: { page: deps.page } }),
      getEventsCount(),
    ])
    return { events, total }
  },
  component: CommunityPage,
})

function CommunityPage() {
  const { events, total } = Route.useLoaderData()
  const search = Route.useSearch()

  const page = search.page
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rangeStartIndex = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEndIndex = Math.min(page * PAGE_SIZE, total)

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader
        title="Community"
        subtitle={`${total} ${total === 1 ? 'event' : 'events'} — shown on the Spades storefront's Events page`}
        action={
          <Link to="/admin/community/new" className={buttonPrimaryClassName}>
            Create event
          </Link>
        }
      />

      <div className={tableWrapperClassName}>
        {events.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">
            No events yet. Create one to have it show up on the Spades
            storefront's Events page.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={tableHeadClassName}>Event</th>
                  <th className={tableHeadClassName}>Status</th>
                  <th className={tableHeadClassName}>When</th>
                  <th className={tableHeadClassName}>Place</th>
                  <th className={`${tableHeadClassName} text-right`}>Slots</th>
                  <th className={`${tableHeadClassName} text-right`}>Fee</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className={tableRowClassName}>
                    <td className={tableCellClassName}>
                      <Link
                        to="/admin/community/$eventId"
                        params={{ eventId: event.id }}
                        className="font-medium text-neutral-900 hover:underline"
                      >
                        {event.name}
                      </Link>
                    </td>
                    <td className={tableCellClassName}>
                      <Badge tone={event.is_active ? 'success' : 'neutral'}>
                        {event.is_active ? 'active' : 'inactive'}
                      </Badge>
                    </td>
                    <td className={`${tableCellClassName} text-neutral-500`}>
                      {new Date(event.starts_at).toLocaleString('en-US', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                        timeZone: 'Asia/Manila',
                      })}
                    </td>
                    <td className={`${tableCellClassName} text-neutral-500`}>
                      {event.location_name}
                    </td>
                    <td className={`${tableCellClassName} text-right`}>
                      {event.slots_reserved} / {event.total_slots}
                    </td>
                    <td className={`${tableCellClassName} text-right`}>
                      {event.fee_cents === 0
                        ? 'Free'
                        : formatCentsAsPHP(event.fee_cents)}
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
              to="/admin/community"
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
              to="/admin/community"
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

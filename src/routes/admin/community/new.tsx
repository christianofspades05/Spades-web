import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { createEvent } from '#/server/admin/events'
import { PageHeader } from '#/components/admin/PageHeader'
import { EventForm } from '#/components/admin/EventForm'
import type { EventInput } from '#/lib/validation/events'

export const Route = createFileRoute('/admin/community/new')({
  component: NewEventPage,
})

function NewEventPage() {
  const navigate = useNavigate()

  async function handleSubmit(data: EventInput) {
    const event = await createEvent({ data })
    await navigate({
      to: '/admin/community/$eventId',
      params: { eventId: event.id },
    })
  }

  return (
    <div className="w-full max-w-2xl px-4 py-6 sm:px-8 sm:py-10">
      <PageHeader title="Create event" />
      <EventForm onSubmit={handleSubmit} submitLabel="Create event" />
    </div>
  )
}

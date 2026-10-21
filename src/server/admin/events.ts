import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { pesosToCents } from '#/lib/utils/money'
import { slugify } from '#/lib/utils/slug'
import { eventInputSchema, updateEventSchema } from '#/lib/validation/events'
import type { EventInput } from '#/lib/validation/events'
import type {
  CommunityEventRow,
  EventRegistrationRow,
} from '#/types/community-events'
import { logStaffActivity } from './activity-log'

const MANAGE_ROLES = ['super_admin', 'admin', 'manager'] as const
const PAGE_SIZE = 20

async function uniqueSlug(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  base: string,
  excludeId?: string,
): Promise<string> {
  let candidate = base
  let n = 2
  for (;;) {
    let query = admin
      .from('community_events')
      .select('id')
      .eq('slug', candidate)
    if (excludeId) query = query.neq('id', excludeId)
    const { data: existing } = await query.maybeSingle<{ id: string }>()
    if (!existing) return candidate
    candidate = `${base}-${n}`
    n += 1
  }
}

function toRow(data: EventInput) {
  return {
    name: data.name,
    location_name: data.locationName,
    location_map_url: data.locationMapUrl || null,
    image_url: data.imageUrl || null,
    starts_at: data.startsAt,
    ends_at: data.endsAt,
    total_slots: data.totalSlots,
    fee_cents: pesosToCents(data.feePesos),
    is_active: data.isActive,
  }
}

export const listEvents = createServerFn({ method: 'GET' })
  .validator(z.object({ page: z.number().int().min(1).default(1) }))
  .handler(async ({ data }): Promise<CommunityEventRow[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const offset = (data.page - 1) * PAGE_SIZE
    const { data: rows, error } = await admin
      .from('community_events')
      .select('*')
      .order('starts_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    return rows
  })

export const getEventsCount = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ total: number }> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { count, error } = await admin
      .from('community_events')
      .select('id', { count: 'exact', head: true })
    if (error) throw error
    return { total: count ?? 0 }
  },
)

export const getEventById = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }): Promise<CommunityEventRow | null> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data: row, error } = await admin
      .from('community_events')
      .select('*')
      .eq('id', data.id)
      .maybeSingle()
    if (error) throw error
    return row
  })

export const createEvent = createServerFn({ method: 'POST' })
  .validator(eventInputSchema)
  .handler(async ({ data }): Promise<CommunityEventRow> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const slug = await uniqueSlug(admin, slugify(data.name))
    const { data: event, error } = await admin
      .from('community_events')
      .insert({ ...toRow(data), slug })
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(
      staff,
      'event.create',
      'community_events',
      event.id,
      {
        name: event.name,
      },
    )
    return event
  })

export const updateEvent = createServerFn({ method: 'POST' })
  .validator(updateEventSchema)
  .handler(async ({ data }): Promise<CommunityEventRow> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: event, error } = await admin
      .from('community_events')
      .update({ ...toRow(data), updated_at: new Date().toISOString() })
      .eq('id', data.id)
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(
      staff,
      'event.update',
      'community_events',
      event.id,
      {
        name: event.name,
      },
    )
    return event
  })

export const createEventImageUploadUrl = createServerFn({ method: 'POST' })
  .validator(z.object({ fileName: z.string() }))
  .handler(
    async ({
      data,
    }): Promise<{ path: string; token: string; publicUrl: string }> => {
      await requireStaff(MANAGE_ROLES)
      const admin = getSupabaseAdminClient()

      const extension = data.fileName.includes('.')
        ? data.fileName.split('.').pop()
        : 'jpg'
      const path = `${crypto.randomUUID()}.${extension}`

      const { data: signed, error } = await admin.storage
        .from('community-events')
        .createSignedUploadUrl(path)
      if (error) throw error

      const { data: publicUrl } = admin.storage
        .from('community-events')
        .getPublicUrl(path)

      return { path, token: signed.token, publicUrl: publicUrl.publicUrl }
    },
  )

export const listEventRegistrations = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      eventId: z.string().uuid(),
      page: z.number().int().min(1).default(1),
    }),
  )
  .handler(async ({ data }): Promise<EventRegistrationRow[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const offset = (data.page - 1) * PAGE_SIZE
    const { data: rows, error } = await admin
      .from('event_registrations')
      .select('*')
      .eq('event_id', data.eventId)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    return rows
  })

export const getEventRegistrationsCount = createServerFn({ method: 'GET' })
  .validator(z.object({ eventId: z.string().uuid() }))
  .handler(async ({ data }): Promise<{ total: number }> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { count, error } = await admin
      .from('event_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', data.eventId)
    if (error) throw error
    return { total: count ?? 0 }
  })

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { pesosToCents } from '#/lib/utils/money'
import { slugify } from '#/lib/utils/slug'
import {
  addEventRegistrationSchema,
  eventInputSchema,
  updateEventSchema,
} from '#/lib/validation/events'
import type { EventInput } from '#/lib/validation/events'
import type {
  CommunityEventRow,
  EventRegistrationRow,
} from '#/types/community-events'
import { logStaffActivity } from './activity-log'
import type { StaffRole } from '#/types/entities'

const MANAGE_ROLES: StaffRole[] = ['super_admin', 'admin', 'manager']
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
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null,
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

/**
 * Staff manually adding a registrant — someone who signed up offline, a
 * walk-in, a comp slot, etc. Goes through the same reserve_event_slot RPC
 * as the public storefront flow (same capacity check, so a manual add
 * still can't push slots_reserved past total_slots), but is confirmed
 * immediately regardless of the event's fee — a staff member adding
 * someone directly means it's already settled (cash at the door, comped),
 * not something waiting on a Xendit payment that will never arrive
 * through this path. Sends the same confirmation email a paid-and-cleared
 * registrant gets.
 */
export const addEventRegistration = createServerFn({ method: 'POST' })
  .validator(addEventRegistrationSchema)
  .handler(async ({ data }): Promise<EventRegistrationRow> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: reserved, error } = await admin.rpc('reserve_event_slot', {
      p_event_id: data.eventId,
      p_full_name: data.fullName,
      p_age: data.age,
      p_email: data.email || null,
      p_phone: data.phone || null,
    })
    if (error) throw error

    const { mintEventRegistration } =
      await import('#/server/events/mint-registration')
    await mintEventRegistration(admin, reserved.id)

    const { data: registration, error: fetchError } = await admin
      .from('event_registrations')
      .select('*')
      .eq('id', reserved.id)
      .single()
    if (fetchError) throw fetchError

    await logStaffActivity(
      staff,
      'event.add_registration',
      'event_registrations',
      registration.id,
      { eventId: data.eventId, fullName: data.fullName },
    )
    return registration
  })

/**
 * Removes a registrant (duplicate signup, no-show cleanup, a walk-in added
 * by mistake) and gives their slot back, regardless of status — unlike
 * release_event_slot (the payment-expiry/failure path, pending-only), this
 * is an explicit staff action and works on a confirmed registration too.
 * Soft-delete only (remove_event_registration sets released_at, same as
 * every other registration-ending path here) so the event keeps a record
 * of who was removed rather than losing the row outright.
 */
export const removeEventRegistration = createServerFn({ method: 'POST' })
  .validator(z.object({ registrationId: z.string().uuid() }))
  .handler(async ({ data }): Promise<EventRegistrationRow> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: registration, error } = await admin.rpc(
      'remove_event_registration',
      { p_registration_id: data.registrationId },
    )
    if (error) throw error

    await logStaffActivity(
      staff,
      'event.remove_registration',
      'event_registrations',
      registration.id,
      { eventId: registration.event_id, fullName: registration.full_name },
    )
    return registration
  })

export interface CreatorPickerResult {
  id: string
  name: string
  email: string | null
}

/** Lightweight — unlike listCreators (src/server/admin/creators.ts), which
 *  joins in financial totals for the Creators & Affiliates page, this only
 *  selects what the "quick add from influencer" picker on the event
 *  registrant form needs: a name and email to prefill. */
export const searchCreatorsForPicker = createServerFn({ method: 'GET' })
  .validator(z.object({ q: z.string().optional() }))
  .handler(async ({ data }): Promise<CreatorPickerResult[]> => {
    await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()
    let query = admin
      .from('creators')
      .select('id, name, email')
      .eq('is_active', true)
      .order('name')
      .limit(50)
    if (data.q) query = query.ilike('name', `%${data.q}%`)
    const { data: rows, error } = await query
    if (error) throw error
    return rows
  })

export interface StaffPickerResult {
  id: string
  name: string
  email: string
}

/** Same idea as listStaffUsers (src/server/admin/settings.ts), but gated
 *  by MANAGE_ROLES instead of that one's super-admin-only
 *  MANAGE_STAFF_ROLES — picking yourself or a teammate for an event
 *  registration isn't the sensitive "manage staff accounts" action that
 *  guard exists for. */
export const searchStaffForPicker = createServerFn({ method: 'GET' })
  .validator(z.object({ q: z.string().optional() }))
  .handler(async ({ data }): Promise<StaffPickerResult[]> => {
    await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()
    let query = admin
      .from('staff_users')
      .select('id, full_name, auth_user_id')
      .eq('is_active', true)
      .order('full_name')
      .limit(50)
    if (data.q) query = query.ilike('full_name', `%${data.q}%`)
    const { data: rows, error } = await query
    if (error) throw error

    return Promise.all(
      rows.map(async (s) => {
        const { data: userData, error: userError } =
          await admin.auth.admin.getUserById(s.auth_user_id)
        if (userError) throw userError
        return {
          id: s.id,
          name: s.full_name,
          email: userData.user.email ?? '',
        }
      }),
    )
  })

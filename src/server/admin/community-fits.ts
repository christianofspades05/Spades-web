import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import {
  createCommunityFitSchema,
  deleteCommunityFitSchema,
  reorderCommunityFitsSchema,
  setCommunityFitActiveSchema,
  updateCommunityFitSchema,
} from '#/lib/validation/admin/community-fits'
import { invalidateCommunityFitsCache } from '#/server/storefront/community-fits'
import type { Database } from '#/types/database.types'
import { logStaffActivity } from './activity-log'
import type { StaffRole } from '#/types/entities'

const MANAGE_ROLES: StaffRole[] = ['super_admin', 'admin', 'manager']
const BUCKET = 'community-fits'
const ALLOWED_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'heic',
  'gif',
])

export type CommunityFitRow =
  Database['public']['Tables']['community_fits']['Row']

export const listCommunityFits = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CommunityFitRow[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data, error } = await admin
      .from('community_fits')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  },
)

export const createCommunityFit = createServerFn({ method: 'POST' })
  .validator(createCommunityFitSchema)
  .handler(async ({ data }): Promise<CommunityFitRow> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    // New posts go to the front of the carousel.
    const { data: first, error: firstError } = await admin
      .from('community_fits')
      .select('sort_order')
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (firstError) throw firstError

    const { data: fit, error } = await admin
      .from('community_fits')
      .insert({
        instagram_url: data.instagramUrl,
        image_url: data.imageUrl,
        handle: data.handle,
        sort_order: (first?.sort_order ?? 1) - 1,
      })
      .select('*')
      .single()
    if (error) throw error

    await invalidateCommunityFitsCache()
    await logStaffActivity(
      staff,
      'community_fit.create',
      'community_fits',
      fit.id,
      {
        instagramUrl: fit.instagram_url,
        handle: fit.handle,
      },
    )
    return fit
  })

export const updateCommunityFit = createServerFn({ method: 'POST' })
  .validator(updateCommunityFitSchema)
  .handler(async ({ data }): Promise<CommunityFitRow> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()
    const { data: fit, error } = await admin
      .from('community_fits')
      .update({
        instagram_url: data.instagramUrl,
        image_url: data.imageUrl,
        handle: data.handle,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.id)
      .select('*')
      .single()
    if (error) throw error

    await invalidateCommunityFitsCache()
    await logStaffActivity(
      staff,
      'community_fit.update',
      'community_fits',
      fit.id,
      {
        instagramUrl: fit.instagram_url,
        handle: fit.handle,
      },
    )
    return fit
  })

export const setCommunityFitActive = createServerFn({ method: 'POST' })
  .validator(setCommunityFitActiveSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()
    const { error } = await admin
      .from('community_fits')
      .update({
        is_active: data.isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.id)
    if (error) throw error

    await invalidateCommunityFitsCache()
    await logStaffActivity(
      staff,
      data.isActive ? 'community_fit.show' : 'community_fit.hide',
      'community_fits',
      data.id,
    )
    return { ok: true }
  })

/** Persists a full reordered list — each fit's sort_order becomes its index. */
export const reorderCommunityFits = createServerFn({ method: 'POST' })
  .validator(reorderCommunityFitsSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()
    const results = await Promise.all(
      data.ids.map((id, index) =>
        admin.from('community_fits').update({ sort_order: index }).eq('id', id),
      ),
    )
    for (const { error } of results) {
      if (error) throw error
    }

    await invalidateCommunityFitsCache()
    await logStaffActivity(
      staff,
      'community_fit.reorder',
      'community_fits',
      null,
      {
        orderedIds: data.ids,
      },
    )
    return { ok: true }
  })

export const deleteCommunityFit = createServerFn({ method: 'POST' })
  .validator(deleteCommunityFitSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()
    const { data: fit, error } = await admin
      .from('community_fits')
      .delete()
      .eq('id', data.id)
      .select('*')
      .maybeSingle()
    if (error) throw error

    // Best-effort cleanup of the uploaded photo — only when it lives in our
    // own bucket. A failure here leaves an orphan file, never a broken page.
    if (fit) {
      const marker = `/storage/v1/object/public/${BUCKET}/`
      const at = fit.image_url.indexOf(marker)
      if (at >= 0) {
        const path = decodeURIComponent(fit.image_url.slice(at + marker.length))
        const { error: removeError } = await admin.storage
          .from(BUCKET)
          .remove([path])
        if (removeError)
          console.error('Community fit photo cleanup failed:', removeError)
      }
    }

    await invalidateCommunityFitsCache()
    await logStaffActivity(
      staff,
      'community_fit.delete',
      'community_fits',
      data.id,
      {
        instagramUrl: fit?.instagram_url ?? null,
        handle: fit?.handle ?? null,
      },
    )
    return { ok: true }
  })

/** Signed upload URL for a fit's photo — the browser uploads the file
 *  straight to Supabase Storage, never base64 through a server function. */
export const createCommunityFitImageUploadUrl = createServerFn({
  method: 'POST',
})
  .validator(z.object({ fileName: z.string().max(300) }))
  .handler(
    async ({
      data,
    }): Promise<{ path: string; token: string; publicUrl: string }> => {
      await requireStaff(MANAGE_ROLES)
      const admin = getSupabaseAdminClient()

      const rawExt = data.fileName.includes('.')
        ? data.fileName.split('.').pop()!.toLowerCase()
        : 'jpg'
      const extension = ALLOWED_EXTENSIONS.has(rawExt) ? rawExt : 'jpg'
      const path = `${crypto.randomUUID()}.${extension}`

      const { data: signed, error } = await admin.storage
        .from(BUCKET)
        .createSignedUploadUrl(path)
      if (error) throw error

      const { data: publicUrl } = admin.storage.from(BUCKET).getPublicUrl(path)
      return { path, token: signed.token, publicUrl: publicUrl.publicUrl }
    },
  )

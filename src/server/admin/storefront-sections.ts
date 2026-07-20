import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  deleteStorefrontSectionSchema,
  reorderStorefrontSectionsSchema,
  setStorefrontSectionActiveSchema,
  storefrontSectionInputSchema,
  STOREFRONT_PAGES,
  updateStorefrontSectionSchema,
} from '#/lib/validation/admin/storefront-sections'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { logStaffActivity } from './activity-log'
import type { StorefrontSection } from '#/types/entities'

const MANAGE_ROLES = ['super_admin', 'admin', 'manager'] as const

export interface StorefrontSectionWithCollection extends StorefrontSection {
  collection: { id: string; name: string; slug: string } | null
}

export const listAllStorefrontSections = createServerFn({
  method: 'GET',
})
  .validator(z.object({ page: z.enum(STOREFRONT_PAGES) }))
  .handler(
    async ({ data }): Promise<StorefrontSectionWithCollection[]> => {
  await requireStaff()
  const admin = getSupabaseAdminClient()

  // Flat query + in-memory join rather than an embedded `collections(...)`
  // select — this project's Supabase types have empty Relationships
  // metadata (see src/server/admin/orders.ts and friends for the same
  // workaround), which breaks TypeScript's inference for embedded selects.
  const { data: sections, error } = await admin
    .from('storefront_sections')
    .select('*')
    .eq('page', data.page)
    .order('sort_order', { ascending: true })
  if (error) throw error

  const collectionIds = Array.from(
    new Set(
      sections
        .map((s) => s.collection_id)
        .filter((id): id is string => id !== null),
    ),
  )
  const collectionsById = new Map<
    string,
    { id: string; name: string; slug: string }
  >()
  if (collectionIds.length > 0) {
    const { data: collections, error: collectionsError } = await admin
      .from('collections')
      .select('id, name, slug')
      .in('id', collectionIds)
    if (collectionsError) throw collectionsError
    for (const c of collections) collectionsById.set(c.id, c)
  }

  return sections.map((s) => ({
    ...s,
    collection: s.collection_id
      ? (collectionsById.get(s.collection_id) ?? null)
      : null,
  }))
    },
  )

export const createStorefrontSection = createServerFn({ method: 'POST' })
  .validator(storefrontSectionInputSchema)
  .handler(async ({ data }): Promise<StorefrontSection> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: maxRow } = await admin
      .from('storefront_sections')
      .select('sort_order')
      .eq('page', data.page)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextSortOrder = (maxRow?.sort_order ?? -1) + 1

    const { data: section, error } = await admin
      .from('storefront_sections')
      .insert({
        type: data.type,
        page: data.page,
        title: data.title ?? null,
        subtitle: data.subtitle ?? null,
        media_url: data.mediaUrl ?? null,
        link_url: data.linkUrl ?? null,
        collection_id: data.collectionId ?? null,
        is_active: data.isActive,
        sort_order: nextSortOrder,
      })
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(
      staff,
      'storefront_section.create',
      'storefront_sections',
      section.id,
      { type: data.type },
    )
    return section
  })

export const updateStorefrontSection = createServerFn({ method: 'POST' })
  .validator(updateStorefrontSectionSchema)
  .handler(async ({ data }): Promise<StorefrontSection> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: section, error } = await admin
      .from('storefront_sections')
      .update({
        type: data.type,
        page: data.page,
        title: data.title ?? null,
        subtitle: data.subtitle ?? null,
        media_url: data.mediaUrl ?? null,
        link_url: data.linkUrl ?? null,
        collection_id: data.collectionId ?? null,
        is_active: data.isActive,
      })
      .eq('id', data.id)
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(
      staff,
      'storefront_section.update',
      'storefront_sections',
      data.id,
    )
    return section
  })

export const setStorefrontSectionActive = createServerFn({ method: 'POST' })
  .validator(setStorefrontSectionActiveSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('storefront_sections')
      .update({ is_active: data.isActive })
      .eq('id', data.id)
    if (error) throw error

    await logStaffActivity(
      staff,
      data.isActive
        ? 'storefront_section.show'
        : 'storefront_section.hide',
      'storefront_sections',
      data.id,
    )
    return { ok: true }
  })

export const deleteStorefrontSection = createServerFn({ method: 'POST' })
  .validator(deleteStorefrontSectionSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('storefront_sections')
      .delete()
      .eq('id', data.id)
    if (error) throw error

    await logStaffActivity(
      staff,
      'storefront_section.delete',
      'storefront_sections',
      data.id,
    )
    return { ok: true }
  })

/** Persists a full drag-reordered list in one call — sets each section's sort_order to its index in `orderedIds`. */
export const reorderStorefrontSections = createServerFn({ method: 'POST' })
  .validator(reorderStorefrontSectionsSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    await Promise.all(
      data.orderedIds.map((id, index) =>
        admin
          .from('storefront_sections')
          .update({ sort_order: index })
          .eq('id', id),
      ),
    )

    await logStaffActivity(
      staff,
      'storefront_section.reorder',
      'storefront_sections',
      data.orderedIds[0],
      { orderedIds: data.orderedIds },
    )
    return { ok: true }
  })

export const uploadStorefrontSectionMedia = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      fileName: z.string(),
      contentType: z.string(),
      base64Data: z.string(),
    }),
  )
  .handler(async ({ data }): Promise<{ url: string }> => {
    await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const buffer = Buffer.from(data.base64Data, 'base64')
    if (buffer.byteLength > 40 * 1024 * 1024) {
      throw new Error('File must be smaller than 40MB')
    }

    const extension = data.fileName.includes('.')
      ? data.fileName.split('.').pop()
      : 'jpg'
    const path = `${crypto.randomUUID()}.${extension}`

    const { error } = await admin.storage
      .from('storefront-sections')
      .upload(path, buffer, { contentType: data.contentType })
    if (error) throw error

    const { data: publicUrl } = admin.storage
      .from('storefront-sections')
      .getPublicUrl(path)
    return { url: publicUrl.publicUrl }
  })

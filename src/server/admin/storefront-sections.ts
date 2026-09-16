import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  deleteStorefrontSectionSchema,
  reorderStorefrontSectionsSchema,
  setStorefrontSectionActiveSchema,
  storefrontSectionInputSchema,
  STOREFRONT_BRANDS,
  STOREFRONT_PAGES,
  updateStorefrontSectionSchema,
} from '#/lib/validation/admin/storefront-sections'
import type {
  StorefrontSectionInput,
  UpdateStorefrontSectionInput,
} from '#/lib/validation/admin/storefront-sections'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { invalidateStorefrontSectionsCache } from '#/server/storefront/sections'
import { logStaffActivity } from './activity-log'
import type { StorefrontSection, StaffUser } from '#/types/entities'

const MANAGE_ROLES = ['super_admin', 'admin', 'manager'] as const

export interface StorefrontSectionWithCollection extends StorefrontSection {
  collection: { id: string; name: string; slug: string } | null
}

export const listAllStorefrontSections = createServerFn({
  method: 'GET',
})
  .validator(
    z.object({
      page: z.enum(STOREFRONT_PAGES),
      brand: z.enum(STOREFRONT_BRANDS).default('spades'),
    }),
  )
  .handler(async ({ data }): Promise<StorefrontSectionWithCollection[]> => {
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
      .eq('brand', data.brand)
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
  })

// Wrapped in createServerOnlyFn, not just a plain function — same reasoning
// as server/storefront/sections.ts's fetchStorefrontSectionsConfig: lets
// this be exercised directly in tests without a real TanStack Start
// request context.
export const createStorefrontSectionImpl = createServerOnlyFn(
  async (
    data: StorefrontSectionInput,
    staff: StaffUser,
  ): Promise<StorefrontSection> => {
    const admin = getSupabaseAdminClient()

    const { data: maxRow } = await admin
      .from('storefront_sections')
      .select('sort_order')
      .eq('page', data.page)
      .eq('brand', data.brand)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextSortOrder = (maxRow?.sort_order ?? -1) + 1

    const { data: section, error } = await admin
      .from('storefront_sections')
      .insert({
        type: data.type,
        page: data.page,
        brand: data.brand,
        title: data.title ?? null,
        title_ja: data.titleJa ?? null,
        title_ko: data.titleKo ?? null,
        title_zh: data.titleZh ?? null,
        subtitle: data.subtitle ?? null,
        subtitle_ja: data.subtitleJa ?? null,
        subtitle_ko: data.subtitleKo ?? null,
        subtitle_zh: data.subtitleZh ?? null,
        media_url: data.mediaUrl ?? null,
        link_url: data.linkUrl ?? null,
        collection_id: data.collectionId ?? null,
        is_active: data.isActive,
        sort_order: nextSortOrder,
      })
      .select('*')
      .single()
    if (error) throw error

    await invalidateStorefrontSectionsCache(data.brand, data.page)
    await logStaffActivity(
      staff,
      'storefront_section.create',
      'storefront_sections',
      section.id,
      { type: data.type },
    )
    return section
  },
)

export const createStorefrontSection = createServerFn({ method: 'POST' })
  .validator(storefrontSectionInputSchema)
  .handler(async ({ data }): Promise<StorefrontSection> => {
    const staff = await requireStaff(MANAGE_ROLES)
    return createStorefrontSectionImpl(data, staff)
  })

export const updateStorefrontSectionImpl = createServerOnlyFn(
  async (
    data: UpdateStorefrontSectionInput,
    staff: StaffUser,
  ): Promise<StorefrontSection> => {
    const admin = getSupabaseAdminClient()

    // brand/page are part of this same update payload, so this write can
    // move a section to a different (brand, page) scope — the cached
    // config at its OLD scope needs invalidating too, not just the new
    // one, or a stale copy would keep showing there for up to 300s. An
    // UPDATE...RETURNING only ever reflects the row's post-update state,
    // so the old scope isn't otherwise obtainable without this read.
    const { data: before, error: beforeError } = await admin
      .from('storefront_sections')
      .select('brand, page')
      .eq('id', data.id)
      .single()
    if (beforeError) throw beforeError

    const { data: section, error } = await admin
      .from('storefront_sections')
      .update({
        type: data.type,
        page: data.page,
        brand: data.brand,
        title: data.title ?? null,
        title_ja: data.titleJa ?? null,
        title_ko: data.titleKo ?? null,
        title_zh: data.titleZh ?? null,
        subtitle: data.subtitle ?? null,
        subtitle_ja: data.subtitleJa ?? null,
        subtitle_ko: data.subtitleKo ?? null,
        subtitle_zh: data.subtitleZh ?? null,
        media_url: data.mediaUrl ?? null,
        link_url: data.linkUrl ?? null,
        collection_id: data.collectionId ?? null,
        is_active: data.isActive,
      })
      .eq('id', data.id)
      .select('*')
      .single()
    if (error) throw error

    await invalidateStorefrontSectionsCache(before.brand, before.page)
    if (before.brand !== data.brand || before.page !== data.page) {
      await invalidateStorefrontSectionsCache(data.brand, data.page)
    }
    await logStaffActivity(
      staff,
      'storefront_section.update',
      'storefront_sections',
      data.id,
    )
    return section
  },
)

export const updateStorefrontSection = createServerFn({ method: 'POST' })
  .validator(updateStorefrontSectionSchema)
  .handler(async ({ data }): Promise<StorefrontSection> => {
    const staff = await requireStaff(MANAGE_ROLES)
    return updateStorefrontSectionImpl(data, staff)
  })

export const setStorefrontSectionActiveImpl = createServerOnlyFn(
  async (
    data: z.infer<typeof setStorefrontSectionActiveSchema>,
    staff: StaffUser,
  ): Promise<{ ok: true }> => {
    const admin = getSupabaseAdminClient()

    const { data: section, error } = await admin
      .from('storefront_sections')
      .update({ is_active: data.isActive })
      .eq('id', data.id)
      .select('brand, page')
      .single()
    if (error) throw error

    await invalidateStorefrontSectionsCache(section.brand, section.page)
    await logStaffActivity(
      staff,
      data.isActive ? 'storefront_section.show' : 'storefront_section.hide',
      'storefront_sections',
      data.id,
    )
    return { ok: true }
  },
)

export const setStorefrontSectionActive = createServerFn({ method: 'POST' })
  .validator(setStorefrontSectionActiveSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    return setStorefrontSectionActiveImpl(data, staff)
  })

export const deleteStorefrontSectionImpl = createServerOnlyFn(
  async (
    data: z.infer<typeof deleteStorefrontSectionSchema>,
    staff: StaffUser,
  ): Promise<{ ok: true }> => {
    const admin = getSupabaseAdminClient()

    const { data: section, error } = await admin
      .from('storefront_sections')
      .delete()
      .eq('id', data.id)
      .select('brand, page')
      .single()
    if (error) throw error

    await invalidateStorefrontSectionsCache(section.brand, section.page)
    await logStaffActivity(
      staff,
      'storefront_section.delete',
      'storefront_sections',
      data.id,
    )
    return { ok: true }
  },
)

export const deleteStorefrontSection = createServerFn({ method: 'POST' })
  .validator(deleteStorefrontSectionSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    return deleteStorefrontSectionImpl(data, staff)
  })

/** Persists a full drag-reordered list in one call — sets each section's sort_order to its index in `orderedIds`. */
export const reorderStorefrontSectionsImpl = createServerOnlyFn(
  async (
    data: z.infer<typeof reorderStorefrontSectionsSchema>,
    staff: StaffUser,
  ): Promise<{ ok: true }> => {
    const admin = getSupabaseAdminClient()

    const results = await Promise.all(
      data.orderedIds.map((id, index) =>
        admin
          .from('storefront_sections')
          .update({ sort_order: index })
          .eq('id', id)
          .select('brand, page')
          .single(),
      ),
    )
    for (const { error } of results) {
      if (error) throw error
    }

    // A reorder never changes brand/page, only sort_order — but the
    // reordered ids could in principle span more than one (brand, page)
    // scope, so this invalidates every distinct scope actually touched
    // rather than assuming they're all the same.
    const scopes = new Map<string, { brand: string; page: string }>()
    for (const { data: row } of results) {
      if (row) scopes.set(`${row.brand}:${row.page}`, row)
    }
    await Promise.all(
      Array.from(scopes.values(), ({ brand, page }) =>
        invalidateStorefrontSectionsCache(brand, page),
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
  },
)

export const reorderStorefrontSections = createServerFn({ method: 'POST' })
  .validator(reorderStorefrontSectionsSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    return reorderStorefrontSectionsImpl(data, staff)
  })

/**
 * Returns a short-lived signed upload URL so the browser can upload the
 * file directly to Supabase Storage instead of routing its bytes through
 * this server function. Base64-encoding a file and sending it as a
 * createServerFn body (the old approach) inflates its size by ~37% and
 * runs into Vercel's hard 4.5MB serverless request body cap — a video well
 * under that limit would still get rejected as "Request Entity Too Large"
 * once base64-encoded. The signed token is what gates the upload (only
 * issued after requireStaff passes), not a public bucket-write policy.
 */
export const createStorefrontSectionUploadUrl = createServerFn({
  method: 'POST',
})
  .validator(
    z.object({
      fileName: z.string(),
    }),
  )
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
        .from('storefront-sections')
        .createSignedUploadUrl(path)
      if (error) throw error

      const { data: publicUrl } = admin.storage
        .from('storefront-sections')
        .getPublicUrl(path)

      return { path, token: signed.token, publicUrl: publicUrl.publicUrl }
    },
  )

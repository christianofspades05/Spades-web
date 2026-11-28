import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import {
  createCommunityFitSchema,
  deleteCommunityFitSchema,
  duplicateFitMessage,
  instagramPostUrlVariants,
  instagramShortcode,
  reorderCommunityFitsSchema,
  setCommunityFitActiveSchema,
  setCommunityFitProductsSchema,
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

export interface CommunityFitProduct {
  id: string
  name: string
  image: string | null
  status: string
}

export type CommunityFitWithProducts = CommunityFitRow & {
  products: CommunityFitProduct[]
}

type AdminClient = ReturnType<typeof getSupabaseAdminClient>

async function replaceFitProducts(
  admin: AdminClient,
  fitId: string,
  productIds: string[],
): Promise<void> {
  const { error: deleteError } = await admin
    .from('community_fit_products')
    .delete()
    .eq('fit_id', fitId)
  if (deleteError) throw deleteError
  if (productIds.length === 0) return
  const { error } = await admin.from('community_fit_products').insert(
    productIds.map((productId, index) => ({
      fit_id: fitId,
      product_id: productId,
      sort_order: index,
    })),
  )
  if (error) throw error
}

export const listCommunityFits = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CommunityFitWithProducts[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data: fits, error } = await admin
      .from('community_fits')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
    if (error) throw error

    // Flat queries + in-memory join (this project's Supabase types have empty
    // Relationships metadata, which breaks embedded-select inference). The
    // whole table is a hand-curated list, so it stays small.
    const { data: links, error: linksError } = await admin
      .from('community_fit_products')
      .select('fit_id, product_id, sort_order')
      .order('sort_order', { ascending: true })
    if (linksError) throw linksError

    const productIds = [...new Set(links.map((l) => l.product_id))]
    const productsById = new Map<string, CommunityFitProduct>()
    if (productIds.length > 0) {
      const { data: products, error: productsError } = await admin
        .from('products')
        .select('id, name, images, status')
        .in('id', productIds)
      if (productsError) throw productsError
      for (const p of products) {
        productsById.set(p.id, {
          id: p.id,
          name: p.name,
          image: p.images[0] ?? null,
          status: p.status,
        })
      }
    }

    return fits.map((fit) => ({
      ...fit,
      products: links
        .filter((l) => l.fit_id === fit.id)
        .map((l) => productsById.get(l.product_id))
        .filter((p): p is CommunityFitProduct => p !== undefined),
    }))
  },
)

export const createCommunityFit = createServerFn({ method: 'POST' })
  .validator(createCommunityFitSchema)
  .handler(async ({ data }): Promise<CommunityFitRow> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    // Block the same post being added twice — /p/ and /reel/ links with the
    // same shortcode count as one post. The unique index from migration 0139
    // backs this up if two staff add the same post at the same moment.
    const shortcode = instagramShortcode(data.instagramUrl)
    if (shortcode) {
      const { data: existing, error: existingError } = await admin
        .from('community_fits')
        .select('handle')
        .in('instagram_url', instagramPostUrlVariants(shortcode))
        .limit(1)
        .maybeSingle()
      if (existingError) throw existingError
      if (existing) throw new Error(duplicateFitMessage(existing.handle))
    }

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
    if (error) {
      // 23505 = unique violation: someone added this post a moment ago.
      if (error.code === '23505')
        throw new Error(duplicateFitMessage(data.handle))
      throw error
    }
    try {
      await replaceFitProducts(admin, fit.id, data.productIds)
    } catch (linkError) {
      // Don't leave a half-saved post behind (e.g. a product deleted while
      // the form was open) — roll back the fit so staff can just retry.
      await admin.from('community_fits').delete().eq('id', fit.id)
      throw linkError
    }

    await invalidateCommunityFitsCache()
    await logStaffActivity(
      staff,
      'community_fit.create',
      'community_fits',
      fit.id,
      {
        instagramUrl: fit.instagram_url,
        handle: fit.handle,
        productIds: data.productIds,
      },
    )
    return fit
  })

/** Replaces the products tagged on a fit ("Shop the look" on its tile). */
export const setCommunityFitProducts = createServerFn({ method: 'POST' })
  .validator(setCommunityFitProductsSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()
    await replaceFitProducts(admin, data.id, data.productIds)

    await invalidateCommunityFitsCache()
    await logStaffActivity(
      staff,
      'community_fit.set_products',
      'community_fits',
      data.id,
      { productIds: data.productIds },
    )
    return { ok: true }
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

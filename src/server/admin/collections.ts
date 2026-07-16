import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  collectionInputSchema,
  previewCollectionRulesSchema,
  reorderCollectionProductsSchema,
  updateCollectionSchema,
} from '#/lib/validation/admin/collections'
import { matchesRules } from '#/lib/collections/rules'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { logStaffActivity } from './activity-log'
import type { Collection } from '#/types/entities'

const MANAGE_ROLES = ['super_admin', 'admin', 'manager'] as const

export const listAllCollections = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Collection[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data, error } = await admin
      .from('collections')
      .select('*')
      .order('sort_order', { ascending: true })
    if (error) throw error
    return data
  },
)

export const getCollectionById = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }): Promise<Collection | null> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data: collection, error } = await admin
      .from('collections')
      .select('*')
      .eq('id', data.id)
      .maybeSingle()
    if (error) throw error
    return collection
  })

export const createCollection = createServerFn({ method: 'POST' })
  .validator(collectionInputSchema)
  .handler(async ({ data }): Promise<Collection> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: collection, error } = await admin
      .from('collections')
      .insert({
        slug: data.slug,
        name: data.name,
        description: data.description ?? null,
        image_url: data.imageUrl ?? null,
        is_active: data.isActive,
        sort_order: data.sortOrder,
        hide_out_of_stock_products: data.hideOutOfStockProducts,
        match_type: data.matchType,
        rules: data.rules,
        sort_by: data.sortBy,
      })
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(
      staff,
      'collection.create',
      'collections',
      collection.id,
      { slug: data.slug },
    )
    return collection
  })

export const updateCollection = createServerFn({ method: 'POST' })
  .validator(updateCollectionSchema)
  .handler(async ({ data }): Promise<Collection> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: collection, error } = await admin
      .from('collections')
      .update({
        slug: data.slug,
        name: data.name,
        description: data.description ?? null,
        image_url: data.imageUrl ?? null,
        is_active: data.isActive,
        sort_order: data.sortOrder,
        hide_out_of_stock_products: data.hideOutOfStockProducts,
        match_type: data.matchType,
        rules: data.rules,
        sort_by: data.sortBy,
      })
      .eq('id', data.id)
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(
      staff,
      'collection.update',
      'collections',
      collection.id,
      {},
    )
    return collection
  })

export interface CollectionProduct {
  productId: string
  name: string
  slug: string
  image: string | null
  sortOrder: number
  inStock: boolean
}

export const getCollectionProducts = createServerFn({ method: 'GET' })
  .validator(z.object({ collectionId: z.string().uuid() }))
  .handler(async ({ data }): Promise<CollectionProduct[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const { data: rows, error } = await admin
      .from('product_collections')
      .select(
        'sort_order, product:products(id, name, slug, images, variants:product_variants(inventory(quantity_available)))',
      )
      .eq('collection_id', data.collectionId)
      .order('sort_order', { ascending: true })
    if (error) throw error

    return rows.map((row) => ({
      productId: row.product.id,
      name: row.product.name,
      slug: row.product.slug,
      image: row.product.images[0] ?? null,
      sortOrder: row.sort_order,
      inStock: row.product.variants.some((v) =>
        v.inventory.some((inv) => inv.quantity_available > 0),
      ),
    }))
  })

/** Live preview for the rule builder — evaluates rules against the whole catalog without requiring the collection to be saved first. */
export const previewCollectionRules = createServerFn({ method: 'POST' })
  .validator(previewCollectionRulesSchema)
  .handler(async ({ data }): Promise<CollectionProduct[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const { data: products, error } = await admin
      .from('products')
      .select(
        'id, name, slug, images, product_type, status, tags, created_at, variants:product_variants(price_cents, inventory(quantity_available))',
      )
    if (error) throw error

    const matched = products
      .map((product) => {
        const inventoryStock = product.variants.reduce(
          (sum, v) =>
            sum + v.inventory.reduce((s, inv) => s + inv.quantity_available, 0),
          0,
        )
        const lowestPriceCents = product.variants.reduce<number | null>(
          (min, v) =>
            min === null || v.price_cents < min ? v.price_cents : min,
          null,
        )
        return {
          product,
          inventoryStock,
          lowestPriceCents,
          matches: matchesRules(
            {
              name: product.name,
              productType: product.product_type,
              status: product.status,
              tags: product.tags,
              inventoryStock,
              lowestPriceCents,
            },
            data.rules,
            data.matchType,
          ),
        }
      })
      .filter((p) => p.matches)
      .filter((p) => !data.hideOutOfStockProducts || p.inventoryStock > 0)

    matched.sort((a, b) => {
      switch (data.sortBy) {
        case 'title_asc':
          return a.product.name.localeCompare(b.product.name)
        case 'title_desc':
          return b.product.name.localeCompare(a.product.name)
        case 'price_asc':
          return (a.lowestPriceCents ?? 0) - (b.lowestPriceCents ?? 0)
        case 'price_desc':
          return (b.lowestPriceCents ?? 0) - (a.lowestPriceCents ?? 0)
        case 'created_asc':
          return (
            new Date(a.product.created_at).getTime() -
            new Date(b.product.created_at).getTime()
          )
        case 'created_desc':
        default:
          return (
            new Date(b.product.created_at).getTime() -
            new Date(a.product.created_at).getTime()
          )
      }
    })

    return matched.map((p, index) => ({
      productId: p.product.id,
      name: p.product.name,
      slug: p.product.slug,
      image: p.product.images[0] ?? null,
      sortOrder: index,
      inStock: p.inventoryStock > 0,
    }))
  })

export const addProductToCollection = createServerFn({ method: 'POST' })
  .validator(
    z.object({ collectionId: z.string().uuid(), productId: z.string().uuid() }),
  )
  .handler(async ({ data }): Promise<void> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: existing, error: maxError } = await admin
      .from('product_collections')
      .select('sort_order')
      .eq('collection_id', data.collectionId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (maxError) throw maxError

    const nextSortOrder = (existing?.sort_order ?? -1) + 1

    const { error } = await admin.from('product_collections').insert({
      product_id: data.productId,
      collection_id: data.collectionId,
      sort_order: nextSortOrder,
    })
    if (error) throw error

    await logStaffActivity(
      staff,
      'collection.add_product',
      'product_collections',
      data.collectionId,
      { productId: data.productId },
    )
  })

export const removeProductFromCollection = createServerFn({ method: 'POST' })
  .validator(
    z.object({ collectionId: z.string().uuid(), productId: z.string().uuid() }),
  )
  .handler(async ({ data }): Promise<void> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('product_collections')
      .delete()
      .eq('collection_id', data.collectionId)
      .eq('product_id', data.productId)
    if (error) throw error

    await logStaffActivity(
      staff,
      'collection.remove_product',
      'product_collections',
      data.collectionId,
      { productId: data.productId },
    )
  })

export const reorderCollectionProducts = createServerFn({ method: 'POST' })
  .validator(reorderCollectionProductsSchema)
  .handler(async ({ data }): Promise<void> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    await Promise.all(
      data.orderedProductIds.map((productId, index) =>
        admin
          .from('product_collections')
          .update({ sort_order: index })
          .eq('collection_id', data.collectionId)
          .eq('product_id', productId),
      ),
    )

    await logStaffActivity(
      staff,
      'collection.reorder_products',
      'product_collections',
      data.collectionId,
      { count: data.orderedProductIds.length },
    )
  })

/**
 * Reorders a collection's full drag-and-drop product list, which mixes
 * already-pinned products with ones only there because they currently match
 * the auto-match conditions. Dragging any of the latter into a position
 * pins it (upserts it into product_collections) rather than just updating an
 * existing row, so its position survives even if the conditions later change
 * and it would stop auto-matching.
 */
export const pinAndReorderCollectionProducts = createServerFn({
  method: 'POST',
})
  .validator(reorderCollectionProductsSchema)
  .handler(async ({ data }): Promise<void> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin.from('product_collections').upsert(
      data.orderedProductIds.map((productId, index) => ({
        product_id: productId,
        collection_id: data.collectionId,
        sort_order: index,
      })),
      { onConflict: 'product_id,collection_id' },
    )
    if (error) throw error

    await logStaffActivity(
      staff,
      'collection.pin_and_reorder_products',
      'product_collections',
      data.collectionId,
      { count: data.orderedProductIds.length },
    )
  })

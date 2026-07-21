import { randomUUID } from 'node:crypto'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  duplicateProductSchema,
  inventoryAdjustmentSchema,
  productInputSchema,
  quickEditVariantSchema,
  setProductCollectionsSchema,
  updateProductSchema,
  updateVariantSchema,
  uploadProductImageSchema,
  variantInputSchema,
} from '#/lib/validation/admin/products'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { pesosToCents } from '#/lib/utils/money'
import { slugify } from '#/lib/utils/slug'
import { storeRangeToUtcBounds } from '#/lib/utils/date-range'
import { pushInventoryForVariant } from '#/server/integrations/marketplaces/sync-engine'
import { logStaffActivity } from './activity-log'
import type { Inventory, Product, ProductVariant } from '#/types/entities'

const MANAGE_ROLES = ['super_admin', 'admin', 'manager'] as const

interface VariantWithInventory extends ProductVariant {
  inventory: Inventory[]
}
interface ProductWithDetails extends Product {
  variants: VariantWithInventory[]
  collections: Array<{ collection_id: string }>
}
export interface ProductWithCollectionNames extends ProductWithDetails {
  collections: Array<{ collection_id: string; collection: { name: string } }>
}

export const listAllProducts = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      status: z.string().optional(),
      productType: z.string().optional(),
      q: z.string().optional(),
      collectionId: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data }): Promise<ProductWithCollectionNames[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    let query = admin
      .from('products')
      .select(
        '*, variants:product_variants(*, inventory(*)), collections:product_collections(collection_id, collection:collections(name))',
      )
      .order('created_at', { ascending: false })

    if (data.status) query = query.eq('status', data.status)
    if (data.productType) query = query.eq('product_type', data.productType)

    // Filtered via a separate lookup (rather than an inner-joined embed on
    // `collections`) so the `collections` field in the response still lists
    // every collection a matching product belongs to, not just the one
    // being filtered on.
    if (data.collectionId) {
      const { data: memberships, error: membershipError } = await admin
        .from('product_collections')
        .select('product_id')
        .eq('collection_id', data.collectionId)
      if (membershipError) throw membershipError
      const productIds = memberships.map((m) => m.product_id)
      query = query.in(
        'id',
        productIds.length
          ? productIds
          : ['00000000-0000-0000-0000-000000000000'],
      )
    }

    const search = data.q?.trim()
    if (search) {
      query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%`)
    }

    const { data: products, error } = await query
    if (error) throw error
    return products
  })

export const getProductsByIds = createServerFn({ method: 'GET' })
  .validator(z.object({ ids: z.array(z.string().uuid()) }))
  .handler(async ({ data }): Promise<ProductWithCollectionNames[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const { data: products, error } = await admin
      .from('products')
      .select(
        '*, variants:product_variants(*, inventory(*)), collections:product_collections(collection_id, collection:collections(name))',
      )
      .in('id', data.ids)
      .order('created_at', { ascending: false })
    if (error) throw error
    return products
  })

export const bulkUpdateProductStatus = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      productIds: z.array(z.string().uuid()),
      status: z.enum(['draft', 'active', 'archived']),
    }),
  )
  .handler(async ({ data }): Promise<void> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('products')
      .update({ status: data.status })
      .in('id', data.productIds)
    if (error) throw error

    await logStaffActivity(
      staff,
      'product.bulk_status_update',
      'products',
      'bulk',
      {
        productIds: data.productIds,
        status: data.status,
      },
    )
  })

export interface ProductsOverview {
  range: { from: string; to: string }
  totalProducts: number
  activeProducts: number
  totalUnitsOnHand: number
  lowStockCount: number
  sellThroughRate: number | null
  daysOfInventory: { lowRunwayCount: number; hasVelocityData: boolean }
  abc: {
    hasSales: boolean
    aRevenueCents: number
    bRevenueCents: number
    cRevenueCents: number
  }
}

export const getProductsOverview = createServerFn({ method: 'GET' })
  .validator(z.object({ from: z.string(), to: z.string() }))
  .handler(async ({ data }): Promise<ProductsOverview> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const { start: rangeStart, end: rangeEnd } = storeRangeToUtcBounds(
      data.from,
      data.to,
    )
    const periodDays = Math.max(
      1,
      Math.round(
        (new Date(`${data.to}T00:00:00Z`).getTime() -
          new Date(`${data.from}T00:00:00Z`).getTime()) /
          86_400_000,
      ) + 1,
    )

    const [products, orders] = await Promise.all([
      admin
        .from('products')
        .select(
          'id, status, variants:product_variants(id, inventory(quantity_on_hand, low_stock_threshold))',
        ),
      admin
        .from('orders')
        .select('status, order_items(variant_id, quantity, line_total_cents)')
        .gte('placed_at', rangeStart)
        .lte('placed_at', rangeEnd),
    ])
    if (products.error) throw products.error
    if (orders.error) throw orders.error

    const variantToProduct = new Map<string, string>()
    const onHandByProduct = new Map<string, number>()
    let totalUnitsOnHand = 0
    let lowStockCount = 0

    for (const product of products.data) {
      let productOnHand = 0
      let productLow = false
      for (const variant of product.variants) {
        for (const inv of variant.inventory) {
          productOnHand += inv.quantity_on_hand
          if (inv.quantity_on_hand <= inv.low_stock_threshold) productLow = true
        }
        variantToProduct.set(variant.id, product.id)
      }
      onHandByProduct.set(product.id, productOnHand)
      totalUnitsOnHand += productOnHand
      if (productLow) lowStockCount += 1
    }

    const unitsSoldByProduct = new Map<string, number>()
    const revenueByProduct = new Map<string, number>()
    let totalUnitsSold = 0

    for (const order of orders.data) {
      if (order.status === 'cancelled' || order.status === 'failed') continue
      for (const item of order.order_items) {
        const productId = item.variant_id
          ? variantToProduct.get(item.variant_id)
          : undefined
        if (!productId) continue
        unitsSoldByProduct.set(
          productId,
          (unitsSoldByProduct.get(productId) ?? 0) + item.quantity,
        )
        revenueByProduct.set(
          productId,
          (revenueByProduct.get(productId) ?? 0) + item.line_total_cents,
        )
        totalUnitsSold += item.quantity
      }
    }

    const sellThroughRate =
      totalUnitsSold + totalUnitsOnHand > 0
        ? (totalUnitsSold / (totalUnitsSold + totalUnitsOnHand)) * 100
        : null

    let lowRunwayCount = 0
    for (const [productId, unitsSold] of unitsSoldByProduct) {
      const dailyVelocity = unitsSold / periodDays
      if (dailyVelocity <= 0) continue
      const onHand = onHandByProduct.get(productId) ?? 0
      const daysRemaining = onHand / dailyVelocity
      if (daysRemaining < 30) lowRunwayCount += 1
    }

    const revenues = Array.from(revenueByProduct.values()).sort((a, b) => b - a)
    const totalRevenue = revenues.reduce((sum, r) => sum + r, 0)
    let aRevenueCents = 0
    let bRevenueCents = 0
    let cRevenueCents = 0
    let cumulative = 0
    for (const rev of revenues) {
      cumulative += rev
      const cumulativePct = totalRevenue > 0 ? cumulative / totalRevenue : 0
      if (cumulativePct <= 0.8) aRevenueCents += rev
      else if (cumulativePct <= 0.95) bRevenueCents += rev
      else cRevenueCents += rev
    }

    return {
      range: { from: data.from, to: data.to },
      totalProducts: products.data.length,
      activeProducts: products.data.filter((p) => p.status === 'active').length,
      totalUnitsOnHand,
      lowStockCount,
      sellThroughRate,
      daysOfInventory: {
        lowRunwayCount,
        hasVelocityData: unitsSoldByProduct.size > 0,
      },
      abc: {
        hasSales: totalRevenue > 0,
        aRevenueCents,
        bRevenueCents,
        cRevenueCents,
      },
    }
  })

export const getProductById = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }): Promise<ProductWithDetails | null> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data: product, error } = await admin
      .from('products')
      .select(
        '*, variants:product_variants(*, inventory(*)), collections:product_collections(collection_id)',
      )
      .eq('id', data.id)
      .order('sort_order', { foreignTable: 'variants' })
      .maybeSingle()
    if (error) throw error
    return product
  })

export interface ProductSalesSummary {
  unitsSold: number
  revenueCents: number
}

export const getProductSalesSummary = createServerFn({ method: 'GET' })
  .validator(z.object({ productId: z.string().uuid() }))
  .handler(async ({ data }): Promise<ProductSalesSummary> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const { data: variants, error: variantsError } = await admin
      .from('product_variants')
      .select('id')
      .eq('product_id', data.productId)
    if (variantsError) throw variantsError

    const variantIds = variants.map((v) => v.id)
    if (variantIds.length === 0) return { unitsSold: 0, revenueCents: 0 }

    const { data: items, error } = await admin
      .from('order_items')
      .select('quantity, line_total_cents, order:orders(status)')
      .in('variant_id', variantIds)
    if (error) throw error

    let unitsSold = 0
    let revenueCents = 0
    for (const item of items) {
      if (item.order.status === 'cancelled' || item.order.status === 'failed')
        continue
      unitsSold += item.quantity
      revenueCents += item.line_total_cents
    }
    return { unitsSold, revenueCents }
  })

export const createProduct = createServerFn({ method: 'POST' })
  .validator(productInputSchema)
  .handler(async ({ data }): Promise<Product> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: product, error } = await admin
      .from('products')
      .insert({
        slug: data.slug,
        name: data.name,
        description: data.description ?? null,
        product_type: data.productType,
        status: data.status,
        images: data.images,
        tags: data.tags,
        seo_title: data.seoTitle ?? null,
        seo_description: data.seoDescription ?? null,
      })
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(staff, 'product.create', 'products', product.id, {
      slug: data.slug,
    })
    return product
  })

export const updateProduct = createServerFn({ method: 'POST' })
  .validator(updateProductSchema)
  .handler(async ({ data }): Promise<Product> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: product, error } = await admin
      .from('products')
      .update({
        slug: data.slug,
        name: data.name,
        description: data.description ?? null,
        product_type: data.productType,
        status: data.status,
        images: data.images,
        tags: data.tags,
        seo_title: data.seoTitle ?? null,
        seo_description: data.seoDescription ?? null,
      })
      .eq('id', data.id)
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(staff, 'product.update', 'products', product.id, {})
    return product
  })

async function uniqueSlug(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  base: string,
): Promise<string> {
  let candidate = base
  let n = 2
  for (;;) {
    const { data: existing } = await admin
      .from('products')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle<{ id: string }>()
    if (!existing) return candidate
    candidate = `${base}-${n}`
    n += 1
  }
}

async function uniqueSku(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  base: string,
): Promise<string> {
  let candidate = `${base}-copy`
  let n = 2
  for (;;) {
    const { data: existing } = await admin
      .from('product_variants')
      .select('id')
      .eq('sku', candidate)
      .maybeSingle<{ id: string }>()
    if (!existing) return candidate
    candidate = `${base}-copy-${n}`
    n += 1
  }
}

/** Duplicates a product under a new title. Description, product type, status source, and collections always come along; images and variants (with their stock) are opt-in via checkboxes in the UI. */
export const duplicateProduct = createServerFn({ method: 'POST' })
  .validator(duplicateProductSchema)
  .handler(async ({ data }): Promise<Product> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: original, error: fetchError } = await admin
      .from('products')
      .select(
        '*, variants:product_variants(*, inventory(*)), collections:product_collections(collection_id)',
      )
      .eq('id', data.productId)
      .single()
    if (fetchError) throw fetchError

    const slug = await uniqueSlug(admin, slugify(data.newName))

    const { data: newProduct, error: insertError } = await admin
      .from('products')
      .insert({
        slug,
        name: data.newName,
        description: original.description,
        product_type: original.product_type,
        status: 'draft',
        images: data.duplicateImages ? original.images : [],
        tags: original.tags,
        seo_title: null,
        seo_description: null,
      })
      .select('*')
      .single()
    if (insertError) throw insertError

    if (original.collections.length > 0) {
      const { error: collectionsError } = await admin
        .from('product_collections')
        .insert(
          original.collections.map((c) => ({
            product_id: newProduct.id,
            collection_id: c.collection_id,
            sort_order: 0,
          })),
        )
      if (collectionsError) throw collectionsError
    }

    if (data.duplicateVariants) {
      // Each variant's SKU is already unique from the others, so their
      // "-copy" candidates can't collide with each other either — safe to
      // duplicate every variant concurrently instead of one at a time,
      // which was the slowest part of duplicating a product with a large
      // size/color matrix.
      await Promise.all(
        original.variants.map(async (variant) => {
          const sku = await uniqueSku(admin, variant.sku)
          const { data: newVariant, error: variantError } = await admin
            .from('product_variants')
            .insert({
              product_id: newProduct.id,
              sku,
              size: variant.size,
              color: variant.color,
              style: variant.style,
              price_cents: variant.price_cents,
              compare_at_price_cents: variant.compare_at_price_cents,
              cost_cents: variant.cost_cents,
              weight_grams: variant.weight_grams,
              barcode: null,
              is_active: variant.is_active,
            })
            .select('*')
            .single()
          if (variantError) throw variantError

          const { error: inventoryError } = await admin
            .from('inventory')
            .insert({
              variant_id: newVariant.id,
              location_code: 'main',
              quantity_on_hand: variant.inventory[0]?.quantity_on_hand ?? 0,
            })
          if (inventoryError) throw inventoryError
        }),
      )
    }

    await logStaffActivity(
      staff,
      'product.duplicate',
      'products',
      newProduct.id,
      {
        sourceProductId: data.productId,
      },
    )
    return newProduct
  })

export const uploadProductImage = createServerFn({ method: 'POST' })
  .validator(uploadProductImageSchema)
  .handler(async ({ data }): Promise<{ url: string }> => {
    await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const buffer = Buffer.from(data.base64Data, 'base64')
    if (buffer.byteLength > 8 * 1024 * 1024) {
      throw new Error('Image must be smaller than 8MB')
    }

    const extension = data.fileName.includes('.')
      ? data.fileName.split('.').pop()
      : 'jpg'
    const path = `${randomUUID()}.${extension}`

    const { error } = await admin.storage
      .from('product-images')
      .upload(path, buffer, { contentType: data.contentType })
    if (error) throw error

    const { data: publicUrl } = admin.storage
      .from('product-images')
      .getPublicUrl(path)
    return { url: publicUrl.publicUrl }
  })

export const createVariant = createServerFn({ method: 'POST' })
  .validator(variantInputSchema)
  .handler(async ({ data }): Promise<ProductVariant> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { count: existingCount, error: countError } = await admin
      .from('product_variants')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', data.productId)
    if (countError) throw countError

    const { data: variant, error } = await admin
      .from('product_variants')
      .insert({
        product_id: data.productId,
        sku: data.sku,
        size: data.size ?? null,
        color: data.color ?? null,
        style: data.style ?? null,
        price_cents: pesosToCents(data.pricePesos),
        compare_at_price_cents:
          data.compareAtPricePesos !== undefined
            ? pesosToCents(data.compareAtPricePesos)
            : null,
        cost_cents:
          data.costPesos !== undefined ? pesosToCents(data.costPesos) : null,
        weight_grams: data.weightGrams ?? null,
        barcode: data.barcode ?? null,
        is_active: data.isActive,
        sort_order: existingCount ?? 0,
      })
      .select('*')
      .single()
    if (error) throw error

    const { error: inventoryError } = await admin.from('inventory').insert({
      variant_id: variant.id,
      location_code: 'main',
      quantity_on_hand: 0,
    })
    if (inventoryError) throw inventoryError

    await logStaffActivity(
      staff,
      'variant.create',
      'product_variants',
      variant.id,
      { sku: data.sku },
    )
    return variant
  })

export const reorderVariants = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      productId: z.string().uuid(),
      orderedVariantIds: z.array(z.string().uuid()),
    }),
  )
  .handler(async ({ data }): Promise<void> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const results = await Promise.all(
      data.orderedVariantIds.map((id, index) =>
        admin
          .from('product_variants')
          .update({ sort_order: index })
          .eq('id', id)
          .eq('product_id', data.productId),
      ),
    )
    const failed = results.find((r) => r.error)
    if (failed?.error) throw failed.error

    await logStaffActivity(
      staff,
      'variant.reorder',
      'products',
      data.productId,
      { count: data.orderedVariantIds.length },
    )
  })

export const updateVariant = createServerFn({ method: 'POST' })
  .validator(updateVariantSchema)
  .handler(async ({ data }): Promise<ProductVariant> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: variant, error } = await admin
      .from('product_variants')
      .update({
        sku: data.sku,
        size: data.size ?? null,
        color: data.color ?? null,
        style: data.style ?? null,
        price_cents: pesosToCents(data.pricePesos),
        compare_at_price_cents:
          data.compareAtPricePesos !== undefined
            ? pesosToCents(data.compareAtPricePesos)
            : null,
        cost_cents:
          data.costPesos !== undefined ? pesosToCents(data.costPesos) : null,
        weight_grams: data.weightGrams ?? null,
        barcode: data.barcode ?? null,
        is_active: data.isActive,
      })
      .eq('id', data.id)
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(
      staff,
      'variant.update',
      'product_variants',
      variant.id,
      {},
    )
    return variant
  })

/** Narrow partial update for the Inventory page's quick-edit row — only touches sku/cost, unlike updateVariant which replaces every field. */
export const updateVariantQuickEdit = createServerFn({ method: 'POST' })
  .validator(quickEditVariantSchema)
  .handler(async ({ data }): Promise<ProductVariant> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: variant, error } = await admin
      .from('product_variants')
      .update({
        sku: data.sku,
        cost_cents:
          data.costPesos !== undefined
            ? pesosToCents(data.costPesos)
            : undefined,
      })
      .eq('id', data.id)
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(
      staff,
      'variant.quick_edit',
      'product_variants',
      variant.id,
      {},
    )
    return variant
  })

export interface ProductPickerResult {
  id: string
  name: string
  slug: string
  image: string | null
}

export const searchProductsForPicker = createServerFn({ method: 'GET' })
  .validator(z.object({ q: z.string().optional() }))
  .handler(async ({ data }): Promise<ProductPickerResult[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    let query = admin
      .from('products')
      .select('id, name, slug, images')
      .order('name', { ascending: true })
      .limit(50)

    const search = data.q?.trim()
    if (search) {
      query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%`)
    }

    const { data: products, error } = await query
    if (error) throw error
    return products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      image: p.images[0] ?? null,
    }))
  })

export const setProductCollections = createServerFn({ method: 'POST' })
  .validator(setProductCollectionsSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error: deleteError } = await admin
      .from('product_collections')
      .delete()
      .eq('product_id', data.productId)
    if (deleteError) throw deleteError

    if (data.collectionIds.length > 0) {
      const { error: insertError } = await admin
        .from('product_collections')
        .insert(
          data.collectionIds.map((collectionId, index) => ({
            product_id: data.productId,
            collection_id: collectionId,
            sort_order: index,
          })),
        )
      if (insertError) throw insertError
    }

    await logStaffActivity(
      staff,
      'product.set_collections',
      'products',
      data.productId,
      {
        collectionIds: data.collectionIds,
      },
    )
    return { ok: true }
  })

export const adjustInventory = createServerFn({ method: 'POST' })
  .validator(inventoryAdjustmentSchema)
  .handler(async ({ data }): Promise<Inventory> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: current, error: readError } = await admin
      .from('inventory')
      .select('*')
      .eq('variant_id', data.variantId)
      .eq('location_code', 'main')
      .single()
    if (readError) throw readError

    const { data: updated, error: updateError } = await admin
      .from('inventory')
      .update({
        quantity_on_hand: current.quantity_on_hand + data.quantityDelta,
      })
      .eq('id', current.id)
      .select('*')
      .single()
    if (updateError) throw updateError

    const { error: movementError } = await admin
      .from('inventory_movements')
      .insert({
        variant_id: data.variantId,
        location_code: 'main',
        movement_type: data.quantityDelta > 0 ? 'purchase_in' : 'adjustment',
        quantity_delta: data.quantityDelta,
        note: data.note ?? null,
        created_by: staff.auth_user_id,
      })
    if (movementError) throw movementError

    await logStaffActivity(staff, 'inventory.adjust', 'inventory', updated.id, {
      variantId: data.variantId,
      delta: data.quantityDelta,
    })

    // Awaited (not fire-and-forget) — on serverless, work kicked off after
    // the response is sent isn't guaranteed to finish. A marketplace being
    // down/rate-limited still shouldn't fail the actual stock adjustment
    // though — pushInventoryForVariant already logs its own success/failure
    // to sync_logs and retries with backoff, so swallow the error here.
    await pushInventoryForVariant(data.variantId).catch(() => {})

    return updated
  })

/**
 * Pre-orders (Admin > Products > Pre-Orders) — staff mark specific variants
 * as available for pre-order with an "upcoming quantity" that isn't real
 * stock yet (see supabase/migrations/0086_pre_orders.sql for why this is a
 * separate pool from `inventory`, not a second location row there).
 *
 * A deliberately separate page from the regular variant editor
 * (admin/products.ts) — pre-order management is a distinct workflow
 * (enable, set upcoming quantity, mark stock arrived) that most variants
 * never touch.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { logStaffActivity } from './activity-log'
import type { StaffRole } from '#/types/entities'

const MANAGE_ROLES: StaffRole[] = ['super_admin', 'admin', 'manager']

export interface PreOrderVariantRow {
  variantId: string
  sku: string | null
  size: string | null
  color: string | null
  style: string | null
  isActive: boolean
  isPreOrder: boolean
  preOrderQuantity: number
  preOrderReserved: number
  preOrderAvailable: number
  preOrderArrivalNote: string | null
  /** Real stock on hand — shown for context so staff can see at a glance
   *  whether a variant genuinely has zero real stock (the usual reason to
   *  enable pre-order) without switching to the Inventory page. */
  quantityOnHand: number
  productId: string
  productName: string
  productSlug: string
  productImage: string | null
}

export const listPreOrderVariants = createServerFn({ method: 'GET' })
  .validator(
    z.object({ q: z.string().optional(), onlyEnabled: z.boolean().optional() }),
  )
  .handler(async ({ data }): Promise<PreOrderVariantRow[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    let query = admin
      .from('product_variants')
      .select(
        'id, sku, size, color, style, is_active, is_pre_order, pre_order_quantity, pre_order_reserved, pre_order_available, pre_order_arrival_note, inventory(quantity_on_hand), product:products(id, name, slug, images)',
      )
      .order('sku', { ascending: true })

    if (data.onlyEnabled) {
      query = query.eq('is_pre_order', true)
    }

    const search = data.q?.trim()
    if (search) {
      const { data: matchingProducts } = await admin
        .from('products')
        .select('id')
        .ilike('name', `%${search}%`)
      const productIds = (matchingProducts ?? []).map((p) => p.id)

      const orFilter =
        productIds.length > 0
          ? `sku.ilike.%${search}%,product_id.in.(${productIds.join(',')})`
          : `sku.ilike.%${search}%`
      query = query.or(orFilter)
    }

    const { data: variants, error } = await query
    if (error) throw error

    return variants.map((v) => ({
      variantId: v.id,
      sku: v.sku,
      size: v.size,
      color: v.color,
      style: v.style,
      isActive: v.is_active,
      isPreOrder: v.is_pre_order,
      preOrderQuantity: v.pre_order_quantity,
      preOrderReserved: v.pre_order_reserved,
      preOrderAvailable: v.pre_order_available,
      preOrderArrivalNote: v.pre_order_arrival_note,
      quantityOnHand: v.inventory.reduce(
        (sum, inv) => sum + inv.quantity_on_hand,
        0,
      ),
      productId: v.product.id,
      productName: v.product.name,
      productSlug: v.product.slug,
      productImage: v.product.images[0] ?? null,
    }))
  })

const setPreOrderEnabledSchema = z.object({
  variantId: z.string().uuid(),
  isPreOrder: z.boolean(),
  arrivalNote: z.string().trim().max(200).optional(),
})

export const setPreOrderEnabled = createServerFn({ method: 'POST' })
  .validator(setPreOrderEnabledSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('product_variants')
      .update({
        is_pre_order: data.isPreOrder,
        pre_order_arrival_note: data.arrivalNote || null,
      })
      .eq('id', data.variantId)
    if (error) throw error

    await logStaffActivity(
      staff,
      'pre_order.set_enabled',
      'product_variants',
      data.variantId,
      { isPreOrder: data.isPreOrder },
    )
    return { ok: true }
  })

const adjustPreOrderQuantitySchema = z.object({
  variantId: z.string().uuid(),
  quantityDelta: z.number().int(),
})

export const adjustPreOrderQuantity = createServerFn({ method: 'POST' })
  .validator(adjustPreOrderQuantitySchema)
  .handler(async ({ data }): Promise<{ preOrderQuantity: number }> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: current, error: currentError } = await admin
      .from('product_variants')
      .select('pre_order_quantity')
      .eq('id', data.variantId)
      .single()
    if (currentError) throw currentError

    const nextQuantity = current.pre_order_quantity + data.quantityDelta
    if (nextQuantity < 0) {
      throw new Error("Upcoming quantity can't go below zero.")
    }

    const { data: updated, error } = await admin
      .from('product_variants')
      .update({ pre_order_quantity: nextQuantity })
      .eq('id', data.variantId)
      .select('pre_order_quantity')
      .single()
    if (error) {
      if (
        error.code === '23514' &&
        error.message.includes('pre_order_reserved_le_quantity')
      ) {
        throw new Error(
          "Can't lower the upcoming quantity below what's already claimed by placed pre-orders for this variant.",
        )
      }
      throw error
    }

    await logStaffActivity(
      staff,
      'pre_order.adjust_quantity',
      'product_variants',
      data.variantId,
      { delta: data.quantityDelta, newQuantity: updated.pre_order_quantity },
    )
    return { preOrderQuantity: updated.pre_order_quantity }
  })

const receivePreOrderStockSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().positive(),
})

export interface ReceivePreOrderStockResult {
  /** Order ids that had every one of their pre-order lines covered by this
   *  (or an earlier) arrival and are now ready for normal fulfillment. */
  ordersReady: string[]
  /** How many of the arrived units were claimed by pending orders vs. left
   *  over as plain sellable stock (e.g. more arrived than anyone had
   *  pre-ordered). */
  unitsAllocatedToOrders: number
}

/**
 * Staff record that N units of a pre-order variant have physically
 * arrived. Always adds the full amount to real ('main') inventory — it's
 * genuinely on the shelf now, sellable to anyone. Then, oldest pending
 * pre-order first, claims as many WHOLE waiting lines as the arrived
 * quantity covers: migrates that line's reservation from the pre-order
 * pool onto a real reservation (reserve_variant_stock) and marks the line
 * arrived. Any leftover arrived stock beyond what's claimed simply becomes
 * available for new, non-pre-order purchases.
 */
export const receivePreOrderStock = createServerFn({ method: 'POST' })
  .validator(receivePreOrderStockSchema)
  .handler(
    async ({ data }): Promise<ReceivePreOrderStockResult> => {
      const staff = await requireStaff(MANAGE_ROLES)
      const admin = getSupabaseAdminClient()

      const { data: mainInventory, error: invError } = await admin
        .from('inventory')
        .select('id, quantity_on_hand')
        .eq('variant_id', data.variantId)
        .eq('location_code', 'main')
        .maybeSingle()
      if (invError) throw invError
      if (!mainInventory) {
        throw new Error(
          "This variant has no main inventory row yet — add it from the Inventory page first, then try again.",
        )
      }

      const { error: updateInvError } = await admin
        .from('inventory')
        .update({
          quantity_on_hand: mainInventory.quantity_on_hand + data.quantity,
        })
        .eq('id', mainInventory.id)
      if (updateInvError) throw updateInvError

      await admin.from('inventory_movements').insert({
        variant_id: data.variantId,
        location_code: 'main',
        movement_type: 'purchase_in',
        quantity_delta: data.quantity,
        note: 'Pre-order stock arrived',
        created_by: staff.auth_user_id,
      })

      const { data: variant, error: variantError } = await admin
        .from('product_variants')
        .select('pre_order_quantity')
        .eq('id', data.variantId)
        .single()
      if (variantError) throw variantError

      await admin
        .from('product_variants')
        .update({
          pre_order_quantity: Math.max(
            0,
            variant.pre_order_quantity - data.quantity,
          ),
        })
        .eq('id', data.variantId)

      const { data: pendingItems, error: itemsError } = await admin
        .from('order_items')
        .select(
          'id, order_id, quantity, order:orders(placed_at, status)',
        )
        .eq('variant_id', data.variantId)
        .eq('is_pre_order', true)
        .is('pre_order_stock_arrived_at', null)
      if (itemsError) throw itemsError

      const waiting = pendingItems
        .filter((item) => item.order.status !== 'cancelled')
        .sort(
          (a, b) =>
            new Date(a.order.placed_at).getTime() -
            new Date(b.order.placed_at).getTime(),
        )

      let remaining = data.quantity
      let allocated = 0
      const affectedOrderIds = new Set<string>()
      for (const item of waiting) {
        if (remaining < item.quantity) continue

        const { data: ok, error: reserveError } = await admin.rpc(
          'reserve_variant_stock',
          { p_variant_id: data.variantId, p_quantity: item.quantity },
        )
        if (reserveError || !ok) continue

        await admin.rpc('release_pre_order_stock', {
          p_variant_id: data.variantId,
          p_quantity: item.quantity,
        })
        await admin
          .from('order_items')
          .update({ pre_order_stock_arrived_at: new Date().toISOString() })
          .eq('id', item.id)

        remaining -= item.quantity
        allocated += item.quantity
        affectedOrderIds.add(item.order_id)
      }

      const ordersReady: string[] = []
      for (const orderId of affectedOrderIds) {
        const { data: stillWaiting } = await admin
          .from('order_items')
          .select('id')
          .eq('order_id', orderId)
          .eq('is_pre_order', true)
          .is('pre_order_stock_arrived_at', null)
        if (!stillWaiting || stillWaiting.length === 0) {
          await admin
            .from('orders')
            .update({ pre_order_ready_at: new Date().toISOString() })
            .eq('id', orderId)
          ordersReady.push(orderId)
        }
      }

      await logStaffActivity(
        staff,
        'pre_order.receive_stock',
        'product_variants',
        data.variantId,
        { quantity: data.quantity, ordersReady },
      )

      return { ordersReady, unitsAllocatedToOrders: allocated }
    },
  )

export interface WaitingOrderRow {
  orderId: string
  orderNumber: string
  placedAt: string
  quantity: number
  arrived: boolean
}

export const listOrdersWaitingOnVariant = createServerFn({ method: 'GET' })
  .validator(z.object({ variantId: z.string().uuid() }))
  .handler(async ({ data }): Promise<WaitingOrderRow[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const { data: items, error } = await admin
      .from('order_items')
      .select(
        'quantity, pre_order_stock_arrived_at, order:orders(id, order_number, placed_at, status)',
      )
      .eq('variant_id', data.variantId)
      .eq('is_pre_order', true)
    if (error) throw error

    return items
      .filter((item) => item.order.status !== 'cancelled')
      .map((item) => ({
        orderId: item.order.id,
        orderNumber: item.order.order_number,
        placedAt: item.order.placed_at,
        quantity: item.quantity,
        arrived: item.pre_order_stock_arrived_at !== null,
      }))
      .sort(
        (a, b) => new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime(),
      )
  })

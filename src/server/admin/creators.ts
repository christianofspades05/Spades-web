import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { fetchAllRows } from '#/lib/utils/paginate'
import { creatorCommandSchema } from '#/lib/validation/admin/creators'
import { invalidateDiscountConfigCache } from '#/server/storefront/automatic-sales'
import { pushInventoryForVariant } from '#/server/integrations/marketplaces/sync-engine'
import { creatorTotals } from '#/lib/creators/totals'
import type { CreatorExpense } from '#/types/creators'

const ROLES = ['super_admin', 'admin', 'manager'] as const
async function authorize() {
  const staff = await requireStaff([...ROLES])
  setResponseHeader('Cache-Control', 'no-store')
  return staff
}

export interface CreatorExpenseWithProduct extends CreatorExpense {
  /** Null for non-gift expenses, or a gift whose variant was later deleted
   *  (variant_id is set null on delete, per creator_expenses' FK — the
   *  expense itself is kept for accounting history even though the
   *  product it names is gone). */
  productName: string | null
  variantLabel: string | null
}

/** The "Description" column only ever held whatever staff typed (e.g. "Oct
 *  23 - Pullout") — the gift's actual product/variant was stored
 *  (variant_id) but never surfaced, so two different gifts given the same
 *  day read identically in the Expenses & Gifts table. Two flat queries
 *  (variants, then their products) rather than an embedded select — same
 *  reasoning as searchGiftVariants: this codebase's database.types.ts has
 *  empty Relationships metadata, which breaks PostgREST embed inference. */
async function attachGiftProductNames(
  db: ReturnType<typeof getSupabaseAdminClient>,
  expenses: CreatorExpense[],
): Promise<CreatorExpenseWithProduct[]> {
  const variantIds = Array.from(
    new Set(
      expenses
        .map((e) => e.variant_id)
        .filter((id): id is string => id !== null),
    ),
  )
  if (variantIds.length === 0) {
    return expenses.map((e) => ({
      ...e,
      productName: null,
      variantLabel: null,
    }))
  }

  const { data: variants, error: variantsError } = await db
    .from('product_variants')
    .select('id, product_id, size, color')
    .in('id', variantIds)
  if (variantsError) throw variantsError

  const productIds = Array.from(new Set(variants.map((v) => v.product_id)))
  const { data: products, error: productsError } = await db
    .from('products')
    .select('id, name')
    .in('id', productIds)
  if (productsError) throw productsError
  const productNameById = new Map(products.map((p) => [p.id, p.name]))

  const variantById = new Map(
    variants.map((v) => [
      v.id,
      {
        productName: productNameById.get(v.product_id) ?? null,
        variantLabel: [v.size, v.color].filter(Boolean).join(' / ') || null,
      },
    ]),
  )

  return expenses.map((e) => ({
    ...e,
    productName: e.variant_id
      ? (variantById.get(e.variant_id)?.productName ?? null)
      : null,
    variantLabel: e.variant_id
      ? (variantById.get(e.variant_id)?.variantLabel ?? null)
      : null,
  }))
}

export const listCreators = createServerFn({ method: 'GET' }).handler(
  async () => {
    const staff = await authorize()
    const db = getSupabaseAdminClient()
    const [creators, orders, expenses] = await Promise.all([
      fetchAllRows((offset) =>
        db
          .from('creators')
          .select('*')
          .order('name')
          .range(offset, offset + 999),
      ),
      fetchAllRows((offset) =>
        db
          .from('order_creator_attributions')
          .select('*')
          .order('order_id')
          .range(offset, offset + 999),
      ),
      fetchAllRows((offset) =>
        db
          .from('creator_expenses')
          .select('*')
          .order('id')
          .range(offset, offset + 999),
      ),
    ])
    return {
      canPay: staff.role !== 'manager',
      creators: creators.map((c) => ({
        ...c,
        totals: creatorTotals(
          orders.filter((o) => o.creator_id === c.id),
          expenses.filter((e) => e.creator_id === c.id),
        ),
      })),
    }
  },
)

export const getCreator = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const staff = await authorize()
    const db = getSupabaseAdminClient()
    const [creatorResult, orders, expenses, assignments, payouts, discounts] =
      await Promise.all([
        db.from('creators').select('*').eq('id', data.id).single(),
        fetchAllRows((offset) =>
          db
            .from('order_creator_attributions')
            .select('*')
            .eq('creator_id', data.id)
            .order('created_at', { ascending: false })
            .order('order_id')
            .range(offset, offset + 999),
        ),
        fetchAllRows((offset) =>
          db
            .from('creator_expenses')
            .select('*')
            .eq('creator_id', data.id)
            .order('incurred_at', { ascending: false })
            .order('id')
            .range(offset, offset + 999),
        ).then((rows) => attachGiftProductNames(db, rows)),
        fetchAllRows((offset) =>
          db
            .from('creator_discount_assignments')
            .select('*')
            .eq('creator_id', data.id)
            .order('id')
            .range(offset, offset + 999),
        ),
        fetchAllRows((offset) =>
          db
            .from('creator_payouts')
            .select('*')
            .eq('creator_id', data.id)
            .order('created_at', { ascending: false })
            .order('id')
            .range(offset, offset + 999),
        ),
        fetchAllRows((offset) =>
          db
            .from('discounts')
            .select('id, code, value, type, is_active')
            .eq('kind', 'code')
            .is('email_automation_id', null)
            .order('id')
            .range(offset, offset + 999),
        ),
      ])
    if (creatorResult.error) throw creatorResult.error
    return {
      creator: creatorResult.data,
      orders,
      expenses,
      assignments,
      payouts,
      discounts,
      totals: creatorTotals(orders, expenses),
      canPay: staff.role !== 'manager',
    }
  })

export const creatorCommand = createServerFn({ method: 'POST' })
  .validator(creatorCommandSchema)
  .handler(async ({ data }) => {
    const staff = await authorize()
    const { action, ...payload } = data
    const db = getSupabaseAdminClient()
    const { data: id, error } = await db.rpc('creator_admin_command', {
      p_staff_id: staff.id,
      p_action: action,
      p_data: payload,
    })
    if (error) throw new Error(error.message)
    if (action === 'assign_code' || action === 'save_creator')
      await invalidateDiscountConfigCache()
    if (data.action === 'expense' && data.kind === 'gift' && data.variantId) {
      await pushInventoryForVariant(data.variantId).catch(() => {})
    }
    return { id }
  })

export const searchGiftVariants = createServerFn({ method: 'GET' })
  .validator(z.object({ q: z.string().trim().min(2).max(100) }))
  .handler(async ({ data }) => {
    await authorize()
    const db = getSupabaseAdminClient()
    const escaped = data.q.replace(/[%_]/g, '\\$&')

    const { data: matchingProducts, error: productsError } = await db
      .from('products')
      .select('id')
      .ilike('name', `%${escaped}%`)
      .limit(50)
    if (productsError) throw productsError
    const productIds = matchingProducts.map((p) => p.id)

    const orFilter =
      productIds.length > 0
        ? `sku.ilike.%${escaped}%,product_id.in.(${productIds.join(',')})`
        : `sku.ilike.%${escaped}%`

    const { data: variants, error } = await db
      .from('product_variants')
      .select('id, sku, size, color, cost_cents, product_id')
      .or(orFilter)
      .eq('is_active', true)
      .limit(25)
    if (error) throw error

    const variantProductIds = Array.from(
      new Set(variants.map((v) => v.product_id)),
    )
    const productNameById = new Map<string, string>()
    const { data: products, error: namesError } =
      variantProductIds.length > 0
        ? await db
            .from('products')
            .select('id, name')
            .in('id', variantProductIds)
        : { data: [], error: null }
    if (namesError) throw namesError
    for (const p of products) productNameById.set(p.id, p.name)

    return variants.map((v) => ({
      ...v,
      productName: productNameById.get(v.product_id) ?? null,
    }))
  })

/** Cheap enough to call on every order-detail page load regardless of role
 *  (any staff, not just manager+) — the order page uses this to decide
 *  whether to show the finance panel at all, so a packer/support viewer
 *  never gets thrown a 403 just for opening an order that has nothing to
 *  do with creators. The panel's own contents stay manager+-gated. */
export const orderHasCreatorAttribution = createServerFn({ method: 'GET' })
  .validator(z.object({ orderId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireStaff()
    const { data: row, error } = await getSupabaseAdminClient()
      .from('order_creator_attributions')
      .select('order_id')
      .eq('order_id', data.orderId)
      .maybeSingle()
    if (error) throw error
    return Boolean(row)
  })

export const getOrderCreatorFinance = createServerFn({ method: 'GET' })
  .validator(z.object({ orderId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const staff = await authorize()
    const db = getSupabaseAdminClient()
    const results = await Promise.all([
      db
        .from('order_creator_attributions')
        .select('*')
        .eq('order_id', data.orderId)
        .maybeSingle(),
      db
        .from('order_items')
        .select(
          'id, product_name_snapshot, sku_snapshot, quantity, charged_product_cents, charged_discount_cents',
        )
        .eq('order_id', data.orderId),
      db
        .from('returns')
        .select('id, order_item_id, reason, status, quantity')
        .eq('order_id', data.orderId),
      db.from('order_refunds').select('*').eq('order_id', data.orderId),
      db
        .from('creator_commission_entries')
        .select('*')
        .eq('order_id', data.orderId)
        .order('revision', { ascending: false }),
    ])
    for (const r of results) if (r.error) throw r.error
    return {
      attribution: results[0].data,
      items: results[1].data ?? [],
      returns: results[2].data ?? [],
      refunds: results[3].data ?? [],
      entries: results[4].data ?? [],
      canPay: staff.role !== 'manager',
    }
  })

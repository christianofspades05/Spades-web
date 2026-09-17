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

const ROLES = ['super_admin', 'admin', 'manager'] as const
async function authorize() {
  const staff = await requireStaff([...ROLES])
  setResponseHeader('Cache-Control', 'no-store')
  return staff
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
        ),
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
  .validator(z.object({ sku: z.string().trim().min(2).max(100) }))
  .handler(async ({ data }) => {
    await authorize()
    const { data: variants, error } = await getSupabaseAdminClient()
      .from('product_variants')
      .select('id, sku, size, color, cost_cents')
      .ilike('sku', `%${data.sku.replace(/[%_]/g, '\\$&')}%`)
      .eq('is_active', true)
      .limit(25)
    if (error) throw error
    return variants
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

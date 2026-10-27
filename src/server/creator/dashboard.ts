import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { requireCreator } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { fetchAllRows } from '#/lib/utils/paginate'

/**
 * A creator's own view of their code's performance — deliberately a
 * trimmed-down version of admin/creators.ts's getCreator. Never exposes
 * COGS, store margin/contribution, or any other order's customer details
 * (name, email, address) — only what's about the creator's own code: which
 * orders used it, how much commission each earned, and payout history.
 */
export const getCreatorDashboard = createServerFn({ method: 'GET' }).handler(
  async () => {
    const creator = await requireCreator()
    setResponseHeader('Cache-Control', 'no-store')
    const db = getSupabaseAdminClient()

    const [assignments, attributions, payouts] = await Promise.all([
      fetchAllRows((offset) =>
        db
          .from('creator_discount_assignments')
          .select('id, discount_id, commission_bps, is_active, brand')
          .eq('creator_id', creator.id)
          .range(offset, offset + 999),
      ),
      fetchAllRows((offset) =>
        db
          .from('order_creator_attributions')
          .select(
            'order_id, code_snapshot, commission_bps, status, product_revenue_cents, earned_cents, paid_cents, hold_reasons, eligible_at, created_at',
          )
          .eq('creator_id', creator.id)
          .order('created_at', { ascending: false })
          .range(offset, offset + 999),
      ),
      fetchAllRows((offset) =>
        db
          .from('creator_payouts')
          .select('id, reference, amount_cents, created_at')
          .eq('creator_id', creator.id)
          .order('created_at', { ascending: false })
          .range(offset, offset + 999),
      ),
    ])

    const discountIds = Array.from(
      new Set(assignments.map((a) => a.discount_id)),
    )
    const { data: discounts, error: discountsError } =
      discountIds.length > 0
        ? await db.from('discounts').select('id, code').in('id', discountIds)
        : { data: [], error: null }
    if (discountsError) throw discountsError
    const codeById = new Map(discounts.map((d) => [d.id, d.code]))

    const orderIds = attributions.map((a) => a.order_id)
    const { data: orders, error: ordersError } =
      orderIds.length > 0
        ? await db.from('orders').select('id, order_number').in('id', orderIds)
        : { data: [], error: null }
    if (ordersError) throw ordersError
    const orderNumberById = new Map(orders.map((o) => [o.id, o.order_number]))

    const earned = attributions.reduce((s, a) => s + a.earned_cents, 0)
    const paid = attributions.reduce((s, a) => s + a.paid_cents, 0)
    const pending = attributions
      .filter((a) => a.status === 'PENDING')
      .reduce((s, a) => s + Math.max(0, a.earned_cents - a.paid_cents), 0)
    const approved = attributions
      .filter((a) => a.status === 'APPROVED')
      .reduce((s, a) => s + Math.max(0, a.earned_cents - a.paid_cents), 0)

    return {
      creatorName: creator.name,
      codes: assignments.map((a) => ({
        code: codeById.get(a.discount_id) ?? '(deleted code)',
        commissionBps: a.commission_bps,
        isActive: a.is_active,
        brand: a.brand,
      })),
      totals: {
        orders: attributions.length,
        earned,
        paid,
        pending,
        approved,
      },
      orders: attributions.map((a) => ({
        orderNumber: orderNumberById.get(a.order_id) ?? '(removed order)',
        code: a.code_snapshot,
        status: a.status,
        productRevenueCents: a.product_revenue_cents,
        earnedCents: a.earned_cents,
        paidCents: a.paid_cents,
        holdReasons: a.hold_reasons,
        eligibleAt: a.eligible_at,
        createdAt: a.created_at,
      })),
      payouts,
    }
  },
)

/**
 * Unified admin Expenses page: ads spend (Windsor.ai -> Meta Ads), TikTok
 * Shop fees (reusing tiktok-finance.ts's whole-shop summary), Shopee fees
 * (summed directly from orders.platform_fees_cents — already reconciled by
 * sync-engine.ts's reconcilePlatformFees, no new external call needed), and
 * hand-entered manual expenses (manual_expenses table).
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { pesosToCents } from '#/lib/utils/money'
import { storeRangeToUtcBounds } from '#/lib/utils/date-range'
import { getMetaAdSpendCents } from '#/server/integrations/windsor/client'
import { getTikTokFinanceSummary } from './tiktok-finance'
import { logStaffActivity } from './activity-log'
import type { ManualExpense, StaffRole } from '#/types/entities'

const MANAGE_ROLES: StaffRole[] = ['super_admin', 'admin', 'manager']

export interface ExpensesSummary {
  range: { from: string; to: string }
  adsSpendCents: number
  tiktokFeeCents: number
  shopeeFeeCents: number
  manualExpensesCents: number
  totalCents: number
  manualExpenses: ManualExpense[]
}

async function getShopeeFeeCents(from: string, to: string): Promise<number> {
  const admin = getSupabaseAdminClient()
  const { start, end } = storeRangeToUtcBounds(from, to)
  const { data, error } = await admin
    .from('orders')
    .select('platform_fees_cents')
    .eq('source', 'shopee')
    .gte('created_at', start)
    .lt('created_at', end)
  if (error) throw error
  return data.reduce((sum, row) => sum + row.platform_fees_cents, 0)
}

export const getExpensesSummary = createServerFn({ method: 'GET' })
  .validator(z.object({ from: z.string(), to: z.string() }))
  .handler(async ({ data }): Promise<ExpensesSummary> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const [adsSpendCents, tiktokSummary, shopeeFeeCents, manualExpenses] =
      await Promise.all([
        getMetaAdSpendCents({ from: data.from, to: data.to }),
        getTikTokFinanceSummary({ data }),
        getShopeeFeeCents(data.from, data.to),
        admin
          .from('manual_expenses')
          .select('*')
          .gte('expense_date', data.from)
          .lte('expense_date', data.to)
          .order('expense_date', { ascending: false })
          .then(({ data: rows, error }) => {
            if (error) throw error
            return rows
          }),
      ])

    const tiktokFeeCents = Math.abs(tiktokSummary.totals.feeCents)
    const manualExpensesCents = manualExpenses.reduce(
      (sum, row) => sum + row.amount_cents,
      0,
    )

    return {
      range: data,
      adsSpendCents,
      tiktokFeeCents,
      shopeeFeeCents,
      manualExpensesCents,
      totalCents:
        adsSpendCents + tiktokFeeCents + shopeeFeeCents + manualExpensesCents,
      manualExpenses,
    }
  })

const manualExpenseInputSchema = z.object({
  expenseDate: z.string(),
  category: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  amountPesos: z.number().positive(),
})

export const createManualExpense = createServerFn({ method: 'POST' })
  .validator(manualExpenseInputSchema)
  .handler(async ({ data }): Promise<ManualExpense> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: expense, error } = await admin
      .from('manual_expenses')
      .insert({
        expense_date: data.expenseDate,
        category: data.category,
        description: data.description ?? null,
        amount_cents: pesosToCents(data.amountPesos),
        created_by: staff.id,
      })
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(
      staff,
      'manual_expense.create',
      'manual_expenses',
      expense.id,
      { category: data.category, amountPesos: data.amountPesos },
    )
    return expense
  })

export const deleteManualExpense = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }): Promise<void> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('manual_expenses')
      .delete()
      .eq('id', data.id)
    if (error) throw error

    await logStaffActivity(
      staff,
      'manual_expense.delete',
      'manual_expenses',
      data.id,
    )
  })

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  discountInputSchema,
  setDiscountActiveSchema,
  updateDiscountSchema,
} from '#/lib/validation/admin/discounts'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { pesosToCents } from '#/lib/utils/money'
import { logStaffActivity } from './activity-log'
import type { Discount, DiscountInput } from '#/types/entities'

const MANAGE_ROLES = ['super_admin', 'admin', 'manager'] as const

function toRow(data: DiscountInput) {
  return {
    kind: data.kind,
    title: data.title,
    code: data.kind === 'code' ? (data.code ?? '').toUpperCase() : null,
    type: data.discountType,
    value:
      data.discountType === 'percentage'
        ? Math.round(data.percentageValue ?? 0)
        : pesosToCents(data.amountPesos ?? 0),
    scope: 'all' as const,
    scope_ids: [],
    excluded_collection_ids: data.excludedCollectionIds,
    max_uses: data.maxUses ?? null,
    max_uses_per_customer: data.oneUsePerCustomer ? 1 : null,
    starts_at: data.startsAt ? new Date(data.startsAt).toISOString() : null,
    ends_at: data.endsAt ? new Date(data.endsAt).toISOString() : null,
    is_active: data.isActive,
  }
}

export const listAllDiscounts = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Discount[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data, error } = await admin
      .from('discounts')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data
  },
)

export const getDiscountById = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }): Promise<Discount | null> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data: discount, error } = await admin
      .from('discounts')
      .select('*')
      .eq('id', data.id)
      .maybeSingle()
    if (error) throw error
    return discount
  })

export const createDiscount = createServerFn({ method: 'POST' })
  .validator(discountInputSchema)
  .handler(async ({ data }): Promise<Discount> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: discount, error } = await admin
      .from('discounts')
      .insert(toRow(data))
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(staff, 'discount.create', 'discounts', discount.id, {
      kind: data.kind,
      title: data.title,
    })
    return discount
  })

export const updateDiscount = createServerFn({ method: 'POST' })
  .validator(updateDiscountSchema)
  .handler(async ({ data }): Promise<Discount> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: discount, error } = await admin
      .from('discounts')
      .update(toRow(data))
      .eq('id', data.id)
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(
      staff,
      'discount.update',
      'discounts',
      discount.id,
      {},
    )
    return discount
  })

export const setDiscountActive = createServerFn({ method: 'POST' })
  .validator(setDiscountActiveSchema)
  .handler(async ({ data }): Promise<void> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { error } = await admin
      .from('discounts')
      .update({ is_active: data.isActive })
      .eq('id', data.id)
    if (error) throw error

    await logStaffActivity(staff, 'discount.set_active', 'discounts', data.id, {
      isActive: data.isActive,
    })
  })

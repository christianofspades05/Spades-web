import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  discountInputSchema,
  setDiscountActiveSchema,
  updateDiscountSchema,
} from '#/lib/validation/admin/discounts'
import type { DiscountInput } from '#/lib/validation/admin/discounts'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { pesosToCents } from '#/lib/utils/money'
import { storeLocalDateTimeToUtcIso } from '#/lib/utils/date-range'
import { logStaffActivity } from './activity-log'
import type { Discount } from '#/types/entities'

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
    scope: data.kind === 'automatic' ? data.scope : ('all' as const),
    scope_ids:
      data.kind === 'automatic' && data.scope === 'collection'
        ? data.includedCollectionIds
        : [],
    excluded_collection_ids:
      data.kind === 'automatic' && data.scope === 'all'
        ? data.excludedCollectionIds
        : [],
    max_uses: data.maxUses ?? null,
    max_uses_per_customer: data.oneUsePerCustomer ? 1 : null,
    max_discounted_items: data.maxDiscountedItems ?? null,
    excludes_free_shipping: data.excludesFreeShipping,
    // Meaningful only for an automatic discount — never a code (see
    // resolveDiscountForCart for why the control lives here instead of on
    // individual codes). On a Store sale (scope 'all'), it means "let
    // discount codes stack with me" instead of always getting replaced by
    // whichever code the customer applies. On a Collection sale (scope
    // 'collection'), it means "stack onto an active store-wide sale"
    // instead of standing alone at its own rate (e.g. Clearance) — a
    // completely different axis from the Store sale meaning, just sharing
    // the same column since only one applies per discount's own scope.
    stacks_with_sale: data.kind === 'automatic' ? data.stacksWithSale : false,
    starts_at: data.startsAt
      ? storeLocalDateTimeToUtcIso(data.startsAt)
      : null,
    ends_at: data.endsAt ? storeLocalDateTimeToUtcIso(data.endsAt) : null,
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

const DISCOUNTS_PAGE_SIZE = 50

const discountsFilterSchema = z.object({
  q: z.string().optional(),
})

/** Escapes the wildcards PostgREST's ilike/or-clause parser treats specially
 *  (%, comma, and the pattern-match chars themselves) so a search term that
 *  happens to contain one doesn't silently broaden the match or break the
 *  `.or()` clause's comma-separated syntax — same convention used by
 *  admin/customers.ts's buildSearchClause. */
function sanitizeDiscountSearch(q: string | undefined): string | null {
  const trimmed = q?.trim()
  if (!trimmed) return null
  return trimmed.replace(/[%,]/g, '')
}

function buildDiscountSearchClause(search: string): string {
  return `title.ilike.%${search}%,code.ilike.%${search}%`
}

/** Paginated discounts for the admin Discounts list — listAllDiscounts above
 *  stays unpaginated for the email automation discount picker, which
 *  genuinely needs the full set for a dropdown. */
export const listDiscounts = createServerFn({ method: 'GET' })
  .validator(
    discountsFilterSchema.extend({
      page: z.number().int().min(1).default(1),
    }),
  )
  .handler(async ({ data }): Promise<Discount[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const search = sanitizeDiscountSearch(data.q)
    const offset = (data.page - 1) * DISCOUNTS_PAGE_SIZE

    let query = admin.from('discounts').select('*')
    if (search) query = query.or(buildDiscountSearchClause(search))
    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + DISCOUNTS_PAGE_SIZE - 1)

    const { data: discounts, error } = await query
    if (error) throw error
    return discounts
  })

export const getDiscountsCount = createServerFn({ method: 'GET' })
  .validator(discountsFilterSchema)
  .handler(async ({ data }): Promise<{ total: number }> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const search = sanitizeDiscountSearch(data.q)
    let query = admin
      .from('discounts')
      .select('id', { count: 'exact', head: true })
    if (search) query = query.or(buildDiscountSearchClause(search))

    const { count, error } = await query
    if (error) throw error
    return { total: count ?? 0 }
  })

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

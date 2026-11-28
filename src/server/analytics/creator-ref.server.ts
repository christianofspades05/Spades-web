import { getCookies } from '@tanstack/react-start/server'
import type { getSupabaseAdminClient } from '#/lib/supabase/admin'

/**
 * Server-only half of creator link tracking (see creator-ref.ts). Kept in
 * a .server.ts module so the storefront bundle (VisitTracker imports
 * creator-ref.ts) never pulls in request-cookie code.
 */

export const CREATOR_REF_COOKIE = 'spades_ref'
export const REF_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

type Admin = ReturnType<typeof getSupabaseAdminClient>

export interface CreatorRef {
  code: string
  creatorId: string
  commissionBps: number
  saleCommissionBps: number
}

/** The active creator code `code` on `brand`, or null. Case-insensitive. */
export async function resolveCreatorRef(
  admin: Admin,
  code: string,
  brand: string,
): Promise<CreatorRef | null> {
  const trimmed = code.trim()
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(trimmed)) return null
  const { data: discounts, error } = await admin
    .from('discounts')
    .select('id, code')
    .eq('kind', 'code')
    .ilike(
      'code',
      trimmed.replace(/[\\%_]/g, (c) => `\\${c}`),
    )
    .limit(5)
  if (error) throw error
  for (const discount of discounts) {
    const { data: assignment, error: aErr } = await admin
      .from('creator_discount_assignments')
      .select(
        'creator_id, brand, is_active, commission_bps, sale_commission_bps',
      )
      .eq('discount_id', discount.id)
      .maybeSingle()
    if (aErr) throw aErr
    if (!assignment || !assignment.is_active || assignment.brand !== brand)
      continue
    const { data: creator, error: cErr } = await admin
      .from('creators')
      .select('is_active')
      .eq('id', assignment.creator_id)
      .single()
    if (cErr) throw cErr
    if (!creator.is_active) continue
    return {
      code: discount.code ?? trimmed,
      creatorId: assignment.creator_id,
      commissionBps: assignment.commission_bps,
      saleCommissionBps: assignment.sale_commission_bps,
    }
  }
  return null
}

/** The creator ref from this request's cookie, still valid on `brand`. */
export async function getCreatorRefFromCookie(
  admin: Admin,
  brand: string,
): Promise<CreatorRef | null> {
  const code = getCookies()[CREATOR_REF_COOKIE]
  if (!code) return null
  return resolveCreatorRef(admin, decodeURIComponent(code), brand)
}

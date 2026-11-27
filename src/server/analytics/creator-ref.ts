import { createServerFn } from '@tanstack/react-start'
import { getCookies, setCookie } from '@tanstack/react-start/server'
import { z } from 'zod'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'

/**
 * Creator link tracking: https://<store>/?ref=<CODE> (migration 0138).
 *
 * Landing with a valid code sets a 30-day first-party cookie and logs one
 * storefront_visits row (event_type 'creator_link_visit', metadata
 * {creator_id} — no PII). At checkout, an order with no creator code but a
 * valid cookie is attributed to that creator as a 'link' order — see
 * resolveCreatorRef below and creator_capture_attribution in 0138.
 */

export const CREATOR_REF_COOKIE = 'spades_ref'
const REF_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

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

/** Called once when a shopper lands with ?ref=CODE (VisitTracker.tsx). */
export const recordCreatorLinkVisit = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      ref: z.string().trim().min(1).max(64),
      visitorId: z.string().uuid(),
      path: z.string().trim().min(1).max(500),
    }),
  )
  .handler(async ({ data }) => {
    const admin = getSupabaseAdminClient()
    const { getStorefrontScope } = await import('#/server/storefront/domain')
    const scope = await getStorefrontScope()
    const ref = await resolveCreatorRef(admin, data.ref, scope.brand)
    // Unknown codes are silently ignored — same response either way.
    if (!ref) return { ok: true }
    setCookie(CREATOR_REF_COOKIE, ref.code, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: REF_COOKIE_MAX_AGE_SECONDS,
    })
    const { error } = await admin.from('storefront_visits').insert({
      visitor_id: data.visitorId,
      path: data.path,
      event_type: 'creator_link_visit',
      metadata: { creator_id: ref.creatorId },
      brand: scope.brand,
    })
    if (error) throw error
    return { ok: true }
  })

/**
 * "Block COD by location" — staff-maintained list (see
 * server/admin/cod-restricted-cities.ts) of PH cities/municipalities with a
 * history of high return/failed-delivery rates from couriers, where Cash on
 * Delivery is no longer offered by default. Matched on the full
 * region+province+city tuple, not city alone — PSGC municipality names can
 * repeat across provinces even though city names generally don't.
 *
 * Not an absolute block, though — a customer with a proven delivery track
 * record (see cod-trust.ts) is still allowed COD even in a flagged city, so
 * this always needs the checkout email alongside the address. That means
 * the eligibility check can't be precomputed as a static list the way it
 * used to be (getActiveCodRestrictedCities, now removed) — it has to be a
 * live per-request call, resolveCodCityEligibility below, used identically
 * by both the payment page's display and place-order.ts's server-side
 * enforcement so they can never disagree.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'

type Admin = ReturnType<typeof getSupabaseAdminClient>

export interface CodRestrictedCityCheck {
  restricted: boolean
  reason: string | null
}

export async function checkCodRestrictedCity(
  admin: Admin,
  address: { region: string; province: string; city: string },
): Promise<CodRestrictedCityCheck> {
  const { data, error } = await admin
    .from('cod_restricted_cities')
    .select('reason')
    .eq('is_active', true)
    .eq('region', address.region)
    .eq('province', address.province)
    .eq('city', address.city)
    .maybeSingle()
  if (error) throw error
  if (!data) return { restricted: false, reason: null }
  return {
    restricted: true,
    reason: data.reason ?? 'Cash on Delivery is not available in your area.',
  }
}

export async function resolveCodCityEligibility(
  admin: Admin,
  params: { email: string; region: string; province: string; city: string },
): Promise<CodRestrictedCityCheck> {
  const cityRestriction = await checkCodRestrictedCity(admin, params)
  if (!cityRestriction.restricted) return cityRestriction

  const { hasProvenCodTrust } = await import('./cod-trust')
  const trusted = await hasProvenCodTrust(admin, params.email)
  if (trusted) return { restricted: false, reason: null }

  return cityRestriction
}

/** Public — the checkout payment page needs this before the customer has
 *  staff auth (no RLS policy exists on this table either; only the
 *  service-role admin client can read it, which is what this calls
 *  internally, same reasoning as resolveCodAvailability). */
export const checkCodCityEligibility = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      email: z.string().trim().email(),
      region: z.string(),
      province: z.string(),
      city: z.string(),
    }),
  )
  .handler(async ({ data }): Promise<CodRestrictedCityCheck> => {
    const admin = getSupabaseAdminClient()
    return resolveCodCityEligibility(admin, data)
  })

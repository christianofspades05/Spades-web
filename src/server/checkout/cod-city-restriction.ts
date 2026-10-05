/**
 * "Block COD by location" — staff-maintained list (see
 * server/admin/cod-restricted-cities.ts) of PH cities/municipalities with a
 * history of high return/failed-delivery rates from couriers, where Cash on
 * Delivery is no longer offered. Matched on the full region+province+city
 * tuple, not city alone — PSGC municipality names can repeat across
 * provinces even though city names generally don't.
 */
import { createServerFn } from '@tanstack/react-start'
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
    reason:
      data.reason ?? 'Cash on Delivery is not available in your area.',
  }
}

/** Public — the checkout payment page needs this before an address is
 *  necessarily final, same reasoning as resolveCodAvailability being
 *  readable without staff auth (no RLS policy exists on this table either;
 *  only the service-role admin client can read it, which is what this
 *  calls internally). The list is small, so the client matches against it
 *  directly rather than a round trip per keystroke. */
export const getActiveCodRestrictedCities = createServerFn({
  method: 'GET',
}).handler(async (): Promise<
  { region: string; province: string; city: string; reason: string | null }[]
> => {
  const admin = getSupabaseAdminClient()
  const { data, error } = await admin
    .from('cod_restricted_cities')
    .select('region, province, city, reason')
    .eq('is_active', true)
  if (error) throw error
  return data
})

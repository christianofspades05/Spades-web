/**
 * "Hide Payments": staff can block Cash on Delivery for specific collections
 * or products (see cod_restrictions table + admin/hide-payments pages) —
 * e.g. a Clearance Sale collection that must be paid online. This is what
 * both the checkout payment page (to hide the COD option) and placeOrder
 * (to reject it server-side even if a stale page slipped through) call.
 */
import { resolveCollectionScopedProductIds } from '#/server/collections/scoped-products'
import type { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type { CartItemWithVariant } from '#/types/entities'

type Admin = ReturnType<typeof getSupabaseAdminClient>

export async function resolveCodAvailability(
  admin: Admin,
  items: CartItemWithVariant[],
): Promise<boolean> {
  const { data: restrictions, error } = await admin
    .from('cod_restrictions')
    .select('scope, scope_ids')
    .eq('is_active', true)
  if (error) throw error
  if (restrictions.length === 0) return true

  const productIds = Array.from(
    new Set(items.map((item) => item.variant.product.id)),
  )
  if (productIds.length === 0) return true

  const productScoped = restrictions.filter((r) => r.scope === 'product')
  const blockedByProduct = new Set(productScoped.flatMap((r) => r.scope_ids))
  if (productIds.some((id) => blockedByProduct.has(id))) return false

  const collectionIds = Array.from(
    new Set(
      restrictions
        .filter((r) => r.scope === 'collection')
        .flatMap((r) => r.scope_ids),
    ),
  )
  if (collectionIds.length === 0) return true

  const blockedByCollection = await resolveCollectionScopedProductIds(
    admin,
    collectionIds,
    productIds,
  )
  return !productIds.some((id) => blockedByCollection.has(id))
}

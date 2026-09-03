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

export interface CodAvailability {
  available: boolean
  /** Customer-facing explanation for why COD is blocked, shown next to a
   *  disabled (not hidden) COD option at checkout — null when available. */
  reason: string | null
}

const AVAILABLE: CodAvailability = { available: true, reason: null }

export async function resolveCodAvailability(
  admin: Admin,
  items: CartItemWithVariant[],
): Promise<CodAvailability> {
  // Pre-order stock isn't real yet — Cash on Delivery would let a customer
  // walk away without paying for something the store hasn't even received.
  // Checked before the cod_restrictions table below since this applies
  // regardless of any staff-configured restriction. placeOrder re-derives
  // this fresh (via loadCartWithItems), so this is the actual server-side
  // enforcement, not just a UI hint.
  if (items.some((item) => item.variant.is_pre_order)) {
    return {
      available: false,
      reason: 'Cash on Delivery is not available for pre-order items.',
    }
  }

  const { data: restrictions, error } = await admin
    .from('cod_restrictions')
    .select('scope, scope_ids')
    .eq('is_active', true)
  if (error) throw error
  if (restrictions.length === 0) return AVAILABLE

  const productIds = Array.from(
    new Set(items.map((item) => item.variant.product.id)),
  )
  if (productIds.length === 0) return AVAILABLE

  const productScoped = restrictions.filter((r) => r.scope === 'product')
  const blockedByProduct = new Set(productScoped.flatMap((r) => r.scope_ids))
  const blockedProductIds = productIds.filter((id) => blockedByProduct.has(id))
  if (blockedProductIds.length > 0) {
    const { data: products } = await admin
      .from('products')
      .select('name')
      .in('id', blockedProductIds)
    const names = (products ?? []).map((p) => p.name)
    return {
      available: false,
      reason:
        names.length > 0
          ? `Cash on Delivery is not available for ${names.join(', ')}.`
          : 'Cash on Delivery is not available for one or more items in your cart.',
    }
  }

  const collectionIds = Array.from(
    new Set(
      restrictions
        .filter((r) => r.scope === 'collection')
        .flatMap((r) => r.scope_ids),
    ),
  )
  if (collectionIds.length === 0) return AVAILABLE

  // Checked one collection at a time (rather than all at once) so the
  // reason names only the collection(s) that actually matched something in
  // THIS cart — not every collection with an active restriction.
  const { data: collections } = await admin
    .from('collections')
    .select('id, name')
    .in('id', collectionIds)
  const nameById = new Map((collections ?? []).map((c) => [c.id, c.name]))

  const perCollectionMatches = await Promise.all(
    collectionIds.map(async (id) => ({
      id,
      matched: await resolveCollectionScopedProductIds(admin, [id], productIds),
    })),
  )
  const blockingNames = perCollectionMatches
    .filter(({ matched }) => productIds.some((id) => matched.has(id)))
    .map(({ id }) => nameById.get(id))
    .filter((name): name is string => Boolean(name))

  if (blockingNames.length === 0) return AVAILABLE

  return {
    available: false,
    reason: `Cash on Delivery is not available for items in the ${blockingNames.join(', ')} collection${blockingNames.length > 1 ? 's' : ''}.`,
  }
}

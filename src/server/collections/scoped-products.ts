/**
 * Shared by anything that scopes a rule (a discount, a COD restriction) to
 * "products in collection X" — a product is in scope if it's manually
 * pinned to one of the collections, or matches one of their auto-match
 * rules. Extracted out of src/server/cart/discount.ts since COD
 * restrictions need the exact same matching.
 */
import { z } from 'zod'
import { collectionRuleSchema, matchesRules } from '#/lib/collections/rules'
import type { CollectionRule } from '#/lib/collections/rules'
import type { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { createPromiseCache } from '#/lib/utils/cache'

type Admin = ReturnType<typeof getSupabaseAdminClient>

interface CollectionScopeData {
  /** Every product pinned to any of the requested collections — NOT
   *  filtered by any one caller's candidateProductIds, since that's what
   *  makes this cacheable across callers that pass different candidate
   *  lists for the exact same collections (e.g. 13 homepage sections all
   *  resolving the same discount's scope against their own 10 products
   *  each). Filtered down to the caller's actual candidates below, after
   *  the cache lookup. */
  pinnedProductIds: Set<string>
  rulesets: { matchType: 'all' | 'any'; rules: CollectionRule[] }[]
}

// Collection membership/rules barely ever change (an admin editing a
// collection), but this is called on every single storefront page that
// prices a product — every homepage section, every product/collection
// page, /products, quick search — via resolveSalePrices below. Same 15s
// TTL and promise-caching rationale as getActiveAutomaticDiscounts/
// getActiveProductsForBrand right next to this file: caching the in-flight
// promise (not just the resolved value) means the Spades homepage's 13
// concurrent product-grid sections, all resolving the same discount scope
// via Promise.all, share the exact same single DB round trip instead of
// firing 13 of each query. Keyed by the sorted collection-id set only —
// collection ids are already brand-specific rows (a Ysrael collection id
// is a different uuid than any Spades one), so there's no brand
// scoping to add and no cross-brand leak risk.
const COLLECTION_SCOPE_CACHE_TTL_MS = 15_000
const collectionScopeCache = createPromiseCache<CollectionScopeData>(
  COLLECTION_SCOPE_CACHE_TTL_MS,
)

function collectionScopeCacheKey(collectionIds: string[]): string {
  return [...collectionIds].sort().join(',')
}

async function fetchCollectionScopeData(
  admin: Admin,
  collectionIds: string[],
): Promise<CollectionScopeData> {
  const [
    { data: pins, error: pinsError },
    { data: collections, error: colError },
  ] = await Promise.all([
    admin
      .from('product_collections')
      .select('product_id')
      .in('collection_id', collectionIds),
    admin
      .from('collections')
      .select('match_type, rules')
      .in('id', collectionIds),
  ])
  if (pinsError) throw pinsError
  if (colError) throw colError

  return {
    pinnedProductIds: new Set(pins.map((p) => p.product_id)),
    rulesets: collections.map((c) => ({
      matchType: c.match_type,
      rules: z.array(collectionRuleSchema).parse(c.rules),
    })),
  }
}

export async function resolveCollectionScopedProductIds(
  admin: Admin,
  collectionIds: string[],
  candidateProductIds: string[],
): Promise<Set<string>> {
  if (candidateProductIds.length === 0 || collectionIds.length === 0) {
    return new Set()
  }

  const { pinnedProductIds: allPinnedProductIds, rulesets } =
    await collectionScopeCache.get(collectionScopeCacheKey(collectionIds), () =>
      fetchCollectionScopeData(admin, collectionIds),
    )

  const candidateSet = new Set(candidateProductIds)
  const pinnedProductIds = new Set(
    [...allPinnedProductIds].filter((id) => candidateSet.has(id)),
  )

  const productsNeedingRuleCheck = candidateProductIds.filter(
    (id) => !pinnedProductIds.has(id),
  )
  const matchedProductIds = new Set(pinnedProductIds)

  if (productsNeedingRuleCheck.length > 0 && rulesets.length > 0) {
    const { data: products, error: productsError } = await admin
      .from('products')
      .select(
        'id, name, product_type, status, tags, variants:product_variants(price_cents, is_active, inventory(quantity_available))',
      )
      .in('id', productsNeedingRuleCheck)
    if (productsError) throw productsError

    for (const product of products) {
      const activeVariants = product.variants.filter((v) => v.is_active)
      const inventoryStock = activeVariants.reduce(
        (sum, v) =>
          sum + v.inventory.reduce((s, inv) => s + inv.quantity_available, 0),
        0,
      )
      const lowestPriceCents = activeVariants.reduce<number | null>(
        (min, v) => (min === null || v.price_cents < min ? v.price_cents : min),
        null,
      )
      const matches = rulesets.some(({ matchType, rules }) =>
        matchesRules(
          {
            name: product.name,
            productType: product.product_type,
            status: product.status,
            tags: product.tags,
            inventoryStock,
            lowestPriceCents,
          },
          rules,
          matchType,
        ),
      )
      if (matches) matchedProductIds.add(product.id)
    }
  }

  return matchedProductIds
}

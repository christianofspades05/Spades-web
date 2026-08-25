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

interface RuleMatchProduct {
  id: string
  name: string
  product_type: string
  status: string
  tags: string[]
  variants: {
    price_cents: number
    is_active: boolean
    inventory: { quantity_available: number }[]
  }[]
}

// Every product in the table, in the exact shape matchesRules needs — not
// filtered by status/brand/candidate list, since the old per-call query
// (`.in('id', candidateIds)`) never filtered by status either (a rule can
// itself check `status`, so a draft product must still be evaluable). This
// is what lets the ruleset-match computation below run once per 15s and be
// shared by every caller regardless of which candidate ids or brand they
// pass in — the table is small (a few hundred rows), so one unfiltered
// fetch is far cheaper than the id-scoped query it replaces was, at any
// real traffic volume.
const RULE_MATCH_PRODUCTS_CACHE_TTL_MS = 15_000
const ruleMatchProductsCache = createPromiseCache<RuleMatchProduct[]>(
  RULE_MATCH_PRODUCTS_CACHE_TTL_MS,
)

function fetchAllProductsForRuleMatch(admin: Admin): Promise<RuleMatchProduct[]> {
  return ruleMatchProductsCache.get('all', async () => {
    const { data, error } = await admin
      .from('products')
      .select(
        'id, name, product_type, status, tags, variants:product_variants(price_cents, is_active, inventory(quantity_available))',
      )
      .overrideTypes<RuleMatchProduct[], { merge: false }>()
    if (error) throw error
    return data
  })
}

function matchesAnyRuleset(
  product: RuleMatchProduct,
  rulesets: { matchType: 'all' | 'any'; rules: CollectionRule[] }[],
): boolean {
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
  return rulesets.some(({ matchType, rules }) =>
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
}

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
  /** Every product IN THE WHOLE TABLE that matches one of `rulesets` —
   *  not filtered by any caller's candidateProductIds, same reasoning as
   *  pinnedProductIds above. A caller only ever sees this intersected with
   *  its own candidate ids (see resolveCollectionScopedProductIds), so a
   *  match belonging to another brand's product never surfaces — that
   *  other brand's id is simply never in any candidate list. */
  matchedProductIds: Set<string>
}

// Collection membership/rules barely ever change (an admin editing a
// collection), but this is called on every single storefront page that
// prices a product — every homepage section, every product/collection
// page, /products, quick search — via resolveSalePrices below. Same 15s
// TTL and promise-caching rationale as getActiveAutomaticDiscounts/
// getActiveProductsForBrand right next to this file: caching the in-flight
// promise (not just the resolved value) means the Spades homepage's
// concurrent product-grid sections, all resolving the same discount scope
// via Promise.all, share the exact same single DB round trip instead of
// firing one of each query per section. Keyed by the sorted collection-id
// set only — collection ids are already brand-specific rows (a Ysrael
// collection id is a different uuid than any Spades one), so there's no
// brand scoping to add and no cross-brand leak risk.
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
    allProducts,
  ] = await Promise.all([
    admin
      .from('product_collections')
      .select('product_id')
      .in('collection_id', collectionIds),
    admin
      .from('collections')
      .select('match_type, rules')
      .in('id', collectionIds),
    fetchAllProductsForRuleMatch(admin),
  ])
  if (pinsError) throw pinsError
  if (colError) throw colError

  const rulesets = collections.map((c) => ({
    matchType: c.match_type,
    rules: z.array(collectionRuleSchema).parse(c.rules),
  }))

  const matchedProductIds = new Set<string>()
  if (rulesets.length > 0) {
    for (const product of allProducts) {
      if (matchesAnyRuleset(product, rulesets)) {
        matchedProductIds.add(product.id)
      }
    }
  }

  return {
    pinnedProductIds: new Set(pins.map((p) => p.product_id)),
    rulesets,
    matchedProductIds,
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

  const {
    pinnedProductIds: allPinnedProductIds,
    matchedProductIds: allMatchedProductIds,
  } = await collectionScopeCache.get(collectionScopeCacheKey(collectionIds), () =>
    fetchCollectionScopeData(admin, collectionIds),
  )

  const result = new Set<string>()
  for (const id of candidateProductIds) {
    if (allPinnedProductIds.has(id) || allMatchedProductIds.has(id)) {
      result.add(id)
    }
  }
  return result
}

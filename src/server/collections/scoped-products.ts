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
import { createSharedCache } from '#/lib/utils/shared-cache'

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
// is what lets the ruleset-match computation below run once per TTL window
// and be shared by every caller regardless of which candidate ids or brand
// they pass in — the table is small (a few hundred rows), so one unfiltered
// fetch is far cheaper than the id-scoped query it replaces was, at any
// real traffic volume.
//
// Backed by Vercel Runtime Cache (shared across every warm instance in the
// region — see shared-cache.ts) rather than a process-local cache, per the
// Sep 2026 audit: inventory/price feed into this cache's rule-matching
// output and change far more often than collection membership does, so
// its TTL is deliberately kept short (Phase 1: unchanged at 15s) and has
// no active invalidation wired up — a longer TTL here would risk a
// product's auto-match collection membership (and therefore its
// discount/COD eligibility) lagging real inventory/price changes for
// longer than is acceptable, unlike collectionScopeCache below.
const RULE_MATCH_PRODUCTS_CACHE_TTL_SECONDS = 15
const ruleMatchProductsCache = createSharedCache<RuleMatchProduct[]>(
  RULE_MATCH_PRODUCTS_CACHE_TTL_SECONDS,
)

function isRuleMatchProductArray(value: unknown): value is RuleMatchProduct[] {
  return Array.isArray(value)
}

function fetchAllProductsForRuleMatch(admin: Admin): Promise<RuleMatchProduct[]> {
  return ruleMatchProductsCache.get(
    'collections:rule-match-products:all',
    async () => {
      const { data, error } = await admin
        .from('products')
        .select(
          'id, name, product_type, status, tags, variants:product_variants(price_cents, is_active, inventory(quantity_available))',
        )
        .overrideTypes<RuleMatchProduct[], { merge: false }>()
      if (error) throw error
      return data
    },
    { isValid: isRuleMatchProductArray },
  )
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

/** Stored/retrieved from Runtime Cache as plain arrays (a Set isn't
 *  JSON-safe over the wire) — resolveCollectionScopedProductIds converts
 *  these to Sets for its own O(1) lookups after the cache read. */
interface SerializableCollectionScopeData {
  /** Every product pinned to any of the requested collections — NOT
   *  filtered by any one caller's candidateProductIds, since that's what
   *  makes this cacheable across callers that pass different candidate
   *  lists for the exact same collections (e.g. 13 homepage sections all
   *  resolving the same discount's scope against their own 10 products
   *  each). Filtered down to the caller's actual candidates below, after
   *  the cache lookup. */
  pinnedProductIds: string[]
  rulesets: { matchType: 'all' | 'any'; rules: CollectionRule[] }[]
  /** Every product IN THE WHOLE TABLE that matches one of `rulesets` —
   *  not filtered by any caller's candidateProductIds, same reasoning as
   *  pinnedProductIds above. A caller only ever sees this intersected with
   *  its own candidate ids (see resolveCollectionScopedProductIds), so a
   *  match belonging to another brand's product never surfaces — that
   *  other brand's id is simply never in any candidate list. */
  matchedProductIds: string[]
}

function isSerializableCollectionScopeData(
  value: unknown,
): value is SerializableCollectionScopeData {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    Array.isArray(v.pinnedProductIds) &&
    Array.isArray(v.matchedProductIds) &&
    Array.isArray(v.rulesets)
  )
}

// Collection membership/rules barely ever change (an admin editing a
// collection), but this is called on every single storefront page that
// prices a product — every homepage section, every product/collection
// page, /products, quick search — via resolveSalePrices below. Backed by
// Vercel Runtime Cache (shared across every warm instance in the region)
// rather than a process-local cache: a Sep 2026 traffic audit found this
// was the dominant source of repeated /rest/v1/collections and
// /rest/v1/product_collections calls — not many distinct cache keys or
// duplicate calls within one request, but many concurrently-active Fluid/
// Lambda instances each keeping its own separate short-lived cache for the
// same data. A shared cache collapses that down to roughly one real fetch
// per TTL window site-wide.
//
// Phase 1 (this change): shared cache + a longer TTL, no active
// invalidation yet — an admin editing collection membership/rules can take
// up to COLLECTION_SCOPE_CACHE_TTL_SECONDS to propagate to the storefront.
// Phase 2 (separate, later change): the admin write paths that change
// collection membership/rules (createCollection, updateCollection,
// addProductToCollection, removeProductFromCollection,
// pinAndReorderCollectionProducts in server/admin/collections.ts, plus
// setProductCollections and duplicateProduct in server/admin/products.ts)
// will call cache.expireTag(`collection:<id>`) after their writes, cutting
// that propagation down to near-immediate. Tagging every cache entry with
// `collection:<id>` for every id in its key (done below) is what makes
// that possible without having to enumerate every discount/COD-restriction
// combination that might reference a given collection.
//
// Keyed by the sorted collection-id set only — collection ids are already
// brand-specific rows (a Ysrael collection id is a different uuid than any
// Spades one), so there's no brand scoping to add and no cross-brand leak
// risk; this is unchanged from the previous process-local cache and must
// stay unchanged (see the isolation tests in scoped-products.test.ts).
const COLLECTION_SCOPE_CACHE_TTL_SECONDS = 5 * 60
const collectionScopeCache = createSharedCache<SerializableCollectionScopeData>(
  COLLECTION_SCOPE_CACHE_TTL_SECONDS,
)

function collectionScopeCacheKey(collectionIds: string[]): string {
  return `collections:scope:${[...collectionIds].sort().join(',')}`
}

function collectionScopeCacheTags(collectionIds: string[]): string[] {
  return collectionIds.map((id) => `collection:${id}`)
}

async function fetchCollectionScopeData(
  admin: Admin,
  collectionIds: string[],
): Promise<SerializableCollectionScopeData> {
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

  const matchedProductIds: string[] = []
  if (rulesets.length > 0) {
    for (const product of allProducts) {
      if (matchesAnyRuleset(product, rulesets)) {
        matchedProductIds.push(product.id)
      }
    }
  }

  return {
    pinnedProductIds: pins.map((p) => p.product_id),
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

  const { pinnedProductIds, matchedProductIds } = await collectionScopeCache.get(
    collectionScopeCacheKey(collectionIds),
    () => fetchCollectionScopeData(admin, collectionIds),
    {
      tags: collectionScopeCacheTags(collectionIds),
      isValid: isSerializableCollectionScopeData,
    },
  )

  const allPinnedProductIds = new Set(pinnedProductIds)
  const allMatchedProductIds = new Set(matchedProductIds)

  const result = new Set<string>()
  for (const id of candidateProductIds) {
    if (allPinnedProductIds.has(id) || allMatchedProductIds.has(id)) {
      result.add(id)
    }
  }
  return result
}

/**
 * Shared by anything that scopes a rule (a discount, a COD restriction) to
 * "products in collection X" — a product is in scope if it's manually
 * pinned to one of the collections, or matches one of their auto-match
 * rules. Extracted out of src/server/cart/discount.ts since COD
 * restrictions need the exact same matching.
 */
import { z } from 'zod'
import { collectionRuleSchema, matchesRules } from '#/lib/collections/rules'
import type { getSupabaseAdminClient } from '#/lib/supabase/admin'

type Admin = ReturnType<typeof getSupabaseAdminClient>

export async function resolveCollectionScopedProductIds(
  admin: Admin,
  collectionIds: string[],
  candidateProductIds: string[],
): Promise<Set<string>> {
  if (candidateProductIds.length === 0 || collectionIds.length === 0) {
    return new Set()
  }

  const [
    { data: pins, error: pinsError },
    { data: collections, error: colError },
  ] = await Promise.all([
    admin
      .from('product_collections')
      .select('product_id')
      .in('collection_id', collectionIds)
      .in('product_id', candidateProductIds),
    admin
      .from('collections')
      .select('match_type, rules')
      .in('id', collectionIds),
  ])
  if (pinsError) throw pinsError
  if (colError) throw colError

  const pinnedProductIds = new Set(pins.map((p) => p.product_id))
  const rulesets = collections.map((c) => ({
    matchType: c.match_type,
    rules: z.array(collectionRuleSchema).parse(c.rules),
  }))

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

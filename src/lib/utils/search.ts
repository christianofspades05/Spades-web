/**
 * Strips everything except letters/digits and lowercases, so punctuation
 * and spacing differences between what a customer/staff member types and
 * what's actually stored (e.g. searching "no fold" for a product named
 * "No-Fold") don't prevent a match. Must mirror the SQL expression used
 * for products.name_search / storefront_product_listing.name_search — see
 * supabase/migrations/0049_product_search_normalization.sql.
 */
export function normalizeSearchTerm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

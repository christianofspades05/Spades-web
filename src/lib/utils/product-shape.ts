import type { StorefrontListingProduct } from '#/server/products/queries'
import type { ProductVariant, ProductWithVariants } from '#/types/entities'

type VariantWithStock = ProductVariant & {
  inventory?: { quantity_available: number }[]
}

/** Adapts a collection-query result (product + variants + inventory) into the shape ProductCard/ProductGrid expect. */
export function toListingProduct(
  p: ProductWithVariants,
): StorefrontListingProduct {
  const variants = p.variants as VariantWithStock[]
  const prices = variants.map((v) => v.price_cents)
  const totalStock = variants.reduce(
    (sum, v) =>
      sum +
      (v.inventory ?? []).reduce((s, inv) => s + inv.quantity_available, 0),
    0,
  )

  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    product_type: p.product_type,
    images: p.images,
    tags: p.tags,
    created_at: p.created_at,
    updated_at: p.updated_at,
    min_price_cents: prices.length ? Math.min(...prices) : 0,
    total_stock: totalStock,
  }
}

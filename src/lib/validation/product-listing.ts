import { z } from 'zod'
import { STOREFRONT_BRANDS } from '#/lib/validation/admin/storefront-sections'

export const PRODUCT_TYPES = [
  'tee',
  'polo',
  'hoodie',
  'jacket',
  'pants',
  'shorts',
  'accessory',
  'other',
] as const
export type ProductType = (typeof PRODUCT_TYPES)[number]

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  tee: 'Tees',
  polo: 'Polos',
  hoodie: 'Hoodies',
  jacket: 'Jackets',
  pants: 'Pants',
  shorts: 'Shorts',
  accessory: 'Accessories',
  other: 'Other',
}

export const PRODUCT_LISTING_PAGE_SIZE = 24

export const SORT_OPTIONS = [
  'stock_desc',
  'newest',
  'price_asc',
  'price_desc',
] as const
export type ProductListingSort = (typeof SORT_OPTIONS)[number]

export const SORT_LABELS: Record<ProductListingSort, string> = {
  stock_desc: 'Inventory: High to Low',
  newest: 'Newest',
  price_asc: 'Price: Low to High',
  price_desc: 'Price: High to Low',
}

export const productListingSearchSchema = z.object({
  type: z.enum(PRODUCT_TYPES).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  inStock: z.coerce.boolean().optional(),
  sort: z.enum(SORT_OPTIONS).catch('stock_desc'),
  page: z.coerce.number().int().min(1).catch(1),
})

export type ProductListingSearch = z.infer<typeof productListingSearchSchema>

export const listStorefrontProductsSchema = z.object({
  type: z.enum(PRODUCT_TYPES).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  minPriceCents: z.number().int().min(0).optional(),
  maxPriceCents: z.number().int().min(0).optional(),
  inStock: z.boolean().optional(),
  sort: z.enum(SORT_OPTIONS).default('stock_desc'),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(PRODUCT_LISTING_PAGE_SIZE),
  // The current domain's brand (see server/storefront/domain.ts) — the
  // listing only ever shows this brand's own products.
  brand: z.enum(STOREFRONT_BRANDS),
})

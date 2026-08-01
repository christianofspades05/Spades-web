import { z } from 'zod'
import { PRODUCT_TYPES } from '#/lib/validation/product-listing'

const marketplaceSchema = z.enum(['tiktok_shop', 'shopee', 'lazada'])

const attributeAnswerSchema = z.object({
  attributeId: z.string(),
  valueId: z.string().optional(),
  value: z.string().optional(),
})

export const setCategoryDefaultSchema = z.object({
  marketplace: marketplaceSchema,
  productType: z.enum(PRODUCT_TYPES),
  categoryId: z.string().trim().min(1),
  categoryName: z.string().trim().min(1),
  attributeDefaults: z.array(attributeAnswerSchema).default([]),
})

export const deleteCategoryDefaultSchema = z.object({
  marketplace: marketplaceSchema,
  productType: z.enum(PRODUCT_TYPES),
})

export type SetCategoryDefaultInput = z.infer<typeof setCategoryDefaultSchema>
export type DeleteCategoryDefaultInput = z.infer<
  typeof deleteCategoryDefaultSchema
>

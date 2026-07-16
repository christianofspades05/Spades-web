import { z } from 'zod'

const PRODUCT_TYPES = [
  'tee',
  'polo',
  'hoodie',
  'jacket',
  'pants',
  'shorts',
  'accessory',
  'other',
] as const
const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const

export const productInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      'Lowercase letters, numbers, and hyphens only',
    ),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  productType: z.enum(PRODUCT_TYPES),
  status: z.enum(PRODUCT_STATUSES),
  images: z.array(z.string().trim().url()).default([]),
  tags: z.array(z.string().trim().min(1).max(50)).default([]),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(500).optional(),
})

export const updateProductSchema = productInputSchema.extend({
  id: z.string().uuid(),
})

export const duplicateProductSchema = z.object({
  productId: z.string().uuid(),
  newName: z.string().trim().min(1).max(200),
  duplicateImages: z.boolean(),
  duplicateVariants: z.boolean(),
})

export const variantInputSchema = z.object({
  productId: z.string().uuid(),
  sku: z.string().trim().min(1).max(100),
  size: z.string().trim().max(50).optional(),
  color: z.string().trim().max(50).optional(),
  style: z.string().trim().max(50).optional(),
  pricePesos: z.number().min(0),
  compareAtPricePesos: z.number().min(0).optional(),
  costPesos: z.number().min(0).optional(),
  weightGrams: z.number().int().min(0).optional(),
  barcode: z.string().trim().max(100).optional(),
  isActive: z.boolean().default(true),
})

export const updateVariantSchema = variantInputSchema.extend({
  id: z.string().uuid(),
})

export const quickEditVariantSchema = z.object({
  id: z.string().uuid(),
  sku: z.string().trim().min(1).max(100),
  costPesos: z.number().min(0).optional(),
})

export const setProductCollectionsSchema = z.object({
  productId: z.string().uuid(),
  collectionIds: z.array(z.string().uuid()),
})

export const uploadProductImageSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(100),
  base64Data: z.string().min(1),
})

export const inventoryAdjustmentSchema = z.object({
  variantId: z.string().uuid(),
  quantityDelta: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Must be non-zero'),
  note: z.string().trim().max(500).optional(),
})

export type ProductInput = z.infer<typeof productInputSchema>
export type UpdateProductInput = z.infer<typeof updateProductSchema>
export type DuplicateProductInput = z.infer<typeof duplicateProductSchema>
export type VariantInput = z.infer<typeof variantInputSchema>
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>
export type QuickEditVariantInput = z.infer<typeof quickEditVariantSchema>
export type SetProductCollectionsInput = z.infer<
  typeof setProductCollectionsSchema
>
export type InventoryAdjustmentInput = z.infer<typeof inventoryAdjustmentSchema>
export type UploadProductImageInput = z.infer<typeof uploadProductImageSchema>

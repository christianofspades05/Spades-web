import { z } from 'zod'
import { collectionRuleSchema, SORT_OPTIONS } from '#/lib/collections/rules'

export const collectionInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      'Lowercase letters, numbers, and hyphens only',
    ),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  imageUrl: z.string().trim().url().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  hideOutOfStockProducts: z.boolean().default(false),
  matchType: z.enum(['all', 'any']).default('all'),
  rules: z.array(collectionRuleSchema).default([]),
  sortBy: z.enum(SORT_OPTIONS).default('title_asc'),
})

export const updateCollectionSchema = collectionInputSchema.extend({
  id: z.string().uuid(),
})

export const reorderCollectionProductsSchema = z.object({
  collectionId: z.string().uuid(),
  orderedProductIds: z.array(z.string().uuid()),
})

export const previewCollectionRulesSchema = z.object({
  rules: z.array(collectionRuleSchema),
  matchType: z.enum(['all', 'any']),
  sortBy: z.enum(SORT_OPTIONS),
  hideOutOfStockProducts: z.boolean().default(false),
})

export type CollectionInput = z.infer<typeof collectionInputSchema>
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>
export type ReorderCollectionProductsInput = z.infer<
  typeof reorderCollectionProductsSchema
>
export type PreviewCollectionRulesInput = z.infer<
  typeof previewCollectionRulesSchema
>

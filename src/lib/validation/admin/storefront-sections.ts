import { z } from 'zod'

export const STOREFRONT_PAGES = ['home', 'about'] as const

export const STOREFRONT_PAGE_LABELS: Record<
  (typeof STOREFRONT_PAGES)[number],
  string
> = {
  home: 'Home',
  about: 'About Us',
}

export const STOREFRONT_SECTION_TYPES = [
  'hero',
  'tagline',
  'image',
  'video',
  'product_grid',
] as const

export const STOREFRONT_SECTION_TYPE_LABELS: Record<
  (typeof STOREFRONT_SECTION_TYPES)[number],
  string
> = {
  hero: 'Hero banner',
  tagline: 'Tagline / statement',
  image: 'Full-width image',
  video: 'Full-width video',
  product_grid: 'Product grid (one collection)',
}

export const storefrontSectionInputSchema = z
  .object({
    type: z.enum(STOREFRONT_SECTION_TYPES),
    page: z.enum(STOREFRONT_PAGES),
    title: z.string().trim().max(200).optional(),
    subtitle: z.string().trim().max(2000).optional(),
    mediaUrl: z.string().trim().max(2000).optional(),
    linkUrl: z.string().trim().max(500).optional(),
    collectionId: z.string().uuid().optional(),
    isActive: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (
      (data.type === 'hero' || data.type === 'image' || data.type === 'video') &&
      !data.mediaUrl
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          data.type === 'video' ? 'Upload a video' : 'Upload an image',
        path: ['mediaUrl'],
      })
    }
    if (data.type === 'tagline' && !data.title) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a heading',
        path: ['title'],
      })
    }
    if (data.type === 'product_grid' && !data.collectionId) {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick a collection',
        path: ['collectionId'],
      })
    }
  })

export const updateStorefrontSectionSchema = storefrontSectionInputSchema.and(
  z.object({ id: z.string().uuid() }),
)

export const reorderStorefrontSectionsSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
})

export const setStorefrontSectionActiveSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
})

export const deleteStorefrontSectionSchema = z.object({
  id: z.string().uuid(),
})

export type StorefrontSectionInput = z.infer<
  typeof storefrontSectionInputSchema
>
export type UpdateStorefrontSectionInput = z.infer<
  typeof updateStorefrontSectionSchema
>

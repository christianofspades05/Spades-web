import { z } from 'zod'

const INSTAGRAM_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
])

/**
 * Returns the canonical post URL (https://www.instagram.com/p/CODE/ or
 * /reel/CODE/) for an instagram.com post or reel link, or null for anything
 * else. Accepts the share-sheet variants people actually paste: tracking
 * query strings (?igsh=...), /reels/ instead of /reel/, and the newer
 * /username/p/CODE/ form.
 */
export function normalizeInstagramPostUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) return null

  const parts = url.pathname.split('/').filter(Boolean)
  const kindIndex = parts.findIndex((p) => /^(p|reel|reels)$/i.test(p))
  // Only "/p/CODE" or "/username/p/CODE" — nothing deeper before the kind.
  if (kindIndex < 0 || kindIndex > 1) return null
  const code = parts[kindIndex + 1]
  if (!code || !/^[A-Za-z0-9_-]+$/.test(code)) return null

  const kind = parts[kindIndex].toLowerCase() === 'p' ? 'p' : 'reel'
  return `https://www.instagram.com/${kind}/${code}/`
}

/** "@Some.User" / "some.user" / an instagram.com profile link → "some.user". */
export function normalizeInstagramHandle(raw: string): string {
  let value = raw.trim()
  const fromUrl = value.match(/instagram\.com\/([A-Za-z0-9._]+)/i)
  if (fromUrl) value = fromUrl[1]
  return value.replace(/^@+/, '').toLowerCase()
}

const instagramUrlSchema = z
  .string()
  .trim()
  .min(1, 'Paste the Instagram post link')
  .max(500)
  .transform((value, ctx) => {
    const normalized = normalizeInstagramPostUrl(value)
    if (!normalized) {
      ctx.addIssue({
        code: 'custom',
        message:
          'That doesn’t look like an Instagram post link (instagram.com/p/… or /reel/…)',
      })
      return z.NEVER
    }
    return normalized
  })

const handleSchema = z
  .string()
  .max(100)
  .transform(normalizeInstagramHandle)
  .refine((h) => /^[a-z0-9._]{1,30}$/.test(h), {
    message: 'Enter the poster’s Instagram @handle',
  })

const productIdsSchema = z
  .array(z.string().uuid())
  .max(10, 'Tag at most 10 products')
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'A product is tagged twice',
  })

export const createCommunityFitSchema = z.object({
  instagramUrl: instagramUrlSchema,
  handle: handleSchema,
  imageUrl: z.string().trim().url('Upload a photo first').max(1000),
  /** Spades products shown in the photo, in display order. */
  productIds: productIdsSchema.default([]),
})
export type CreateCommunityFitInput = z.input<typeof createCommunityFitSchema>

export const setCommunityFitProductsSchema = z.object({
  id: z.string().uuid(),
  productIds: productIdsSchema,
})

export const setCommunityFitActiveSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
})

export const reorderCommunityFitsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
})

export const deleteCommunityFitSchema = z.object({ id: z.string().uuid() })

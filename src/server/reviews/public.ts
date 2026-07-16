/**
 * Public, unauthenticated server functions behind the /review/$token page.
 * Nothing here trusts staff auth — the review_token itself (looked up and
 * checked for expiry/reuse in resolveValidOrderByToken) is what proves the
 * caller actually has the link from a real order's request email.
 */
import { randomUUID } from 'node:crypto'
import { createServerFn } from '@tanstack/react-start'
import {
  reviewTokenSchema,
  submitReviewsSchema,
  uploadReviewPhotoSchema,
} from '#/lib/validation/reviews'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import type { OrderShippingAddress } from '#/lib/checkout/shipping-address'

type Admin = ReturnType<typeof getSupabaseAdminClient>

interface TokenOrder {
  id: string
  order_number: string
  shipping_address: Record<string, unknown>
}

async function resolveValidOrderByToken(
  admin: Admin,
  token: string,
): Promise<TokenOrder | null> {
  const { data: order, error } = await admin
    .from('orders')
    .select(
      'id, order_number, shipping_address, review_token_expires_at, review_token_used_at',
    )
    .eq('review_token', token)
    .maybeSingle()
  if (error) throw error
  if (!order) return null
  if (order.review_token_used_at) return null
  if (
    order.review_token_expires_at &&
    new Date(order.review_token_expires_at) < new Date()
  ) {
    return null
  }
  return order
}

/** Distinct products purchased in the order, resolved via product_variants (which has a real FK relationship, unlike order_items). */
export async function distinctOrderProductIds(
  admin: Admin,
  orderId: string,
): Promise<string[]> {
  const { data: items, error: itemsError } = await admin
    .from('order_items')
    .select('variant_id')
    .eq('order_id', orderId)
  if (itemsError) throw itemsError

  const variantIds = Array.from(
    new Set(items.map((i) => i.variant_id).filter((v): v is string => !!v)),
  )
  if (variantIds.length === 0) return []

  const { data: variants, error: variantsError } = await admin
    .from('product_variants')
    .select('product_id')
    .in('id', variantIds)
  if (variantsError) throw variantsError

  return Array.from(new Set(variants.map((v) => v.product_id)))
}

export interface ReviewRequestProduct {
  id: string
  name: string
  slug: string
  image: string | null
}

export interface ReviewRequestPageData {
  orderNumber: string
  customerName: string | null
  products: ReviewRequestProduct[]
}

export const getReviewRequestByToken = createServerFn({ method: 'GET' })
  .validator(reviewTokenSchema)
  .handler(async ({ data }): Promise<ReviewRequestPageData | null> => {
    const admin = getSupabaseAdminClient()
    const order = await resolveValidOrderByToken(admin, data.token)
    if (!order) return null

    const productIds = await distinctOrderProductIds(admin, order.id)
    const address = order.shipping_address as unknown as OrderShippingAddress

    if (productIds.length === 0) {
      return {
        orderNumber: order.order_number,
        customerName: address.recipientName,
        products: [],
      }
    }

    const [{ data: products, error: productsError }, { data: existing }] =
      await Promise.all([
        admin
          .from('products')
          .select('id, name, slug, images')
          .in('id', productIds),
        admin.from('reviews').select('product_id').eq('order_id', order.id),
      ])
    if (productsError) throw productsError

    const reviewedIds = new Set((existing ?? []).map((r) => r.product_id))

    return {
      orderNumber: order.order_number,
      customerName: address.recipientName,
      products: products
        .filter((p) => !reviewedIds.has(p.id))
        .map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          image: p.images[0] ?? null,
        })),
    }
  })

export const uploadReviewPhoto = createServerFn({ method: 'POST' })
  .validator(uploadReviewPhotoSchema)
  .handler(async ({ data }): Promise<{ url: string }> => {
    const admin = getSupabaseAdminClient()
    const order = await resolveValidOrderByToken(admin, data.token)
    if (!order) {
      throw new Error('This review link is invalid or has expired.')
    }

    const buffer = Buffer.from(data.base64Data, 'base64')
    if (buffer.byteLength > 8 * 1024 * 1024) {
      throw new Error('Photo must be smaller than 8MB')
    }

    const extension = data.fileName.includes('.')
      ? data.fileName.split('.').pop()
      : 'jpg'
    const path = `${randomUUID()}.${extension}`

    const { error } = await admin.storage
      .from('review-photos')
      .upload(path, buffer, { contentType: data.contentType })
    if (error) throw error

    const { data: publicUrl } = admin.storage
      .from('review-photos')
      .getPublicUrl(path)
    return { url: publicUrl.publicUrl }
  })

export const submitReviews = createServerFn({ method: 'POST' })
  .validator(submitReviewsSchema)
  .handler(async ({ data }): Promise<{ success: true }> => {
    const admin = getSupabaseAdminClient()
    const order = await resolveValidOrderByToken(admin, data.token)
    if (!order) {
      throw new Error('This review link is invalid or has expired.')
    }

    // Never trust productId from the client without checking it against
    // what was actually in this order.
    const validProductIds = new Set(
      await distinctOrderProductIds(admin, order.id),
    )
    const address = order.shipping_address as unknown as OrderShippingAddress

    const rows = data.reviews
      .filter((r) => validProductIds.has(r.productId))
      .map((r) => ({
        product_id: r.productId,
        order_id: order.id,
        customer_email: address.email,
        customer_name: address.recipientName,
        rating: r.rating,
        review_text: r.reviewText ?? null,
        photo_urls: r.photoUrls,
        status: 'pending' as const,
      }))
    if (rows.length === 0) {
      throw new Error('No valid products to review for this order.')
    }

    const { error: insertError } = await admin.from('reviews').insert(rows)
    if (insertError) throw insertError

    const { error: updateError } = await admin
      .from('orders')
      .update({ review_token_used_at: new Date().toISOString() })
      .eq('id', order.id)
    if (updateError) throw updateError

    return { success: true }
  })

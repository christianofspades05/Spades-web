/**
 * Authenticated review flow for a delivered order, viewed from the
 * customer's own account — same `reviews` table and one-row-per-product-
 * per-order rule as the emailed token-based flow (src/server/reviews/public.ts),
 * but gated by requireCustomer() + order ownership instead of a review_token.
 */
import { randomUUID } from 'node:crypto'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireCustomer } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { reviewSubmissionItemSchema } from '#/lib/validation/reviews'
import { distinctOrderProductIds } from '#/server/reviews/public'

type Admin = ReturnType<typeof getSupabaseAdminClient>

/**
 * "Delivered" can be recorded two ways in the admin: the order's own status
 * field (shipped -> delivered transition), or the shipment's own status
 * field (set independently from the shipment/tracking form) — mirrors the
 * same either-way check in src/server/account/queries.ts's getAccountOverview.
 */
async function requireDeliveredOwnOrder(
  admin: Admin,
  customerId: string,
  orderId: string,
): Promise<{ id: string; order_number: string }> {
  const { data: order, error } = await admin
    .from('orders')
    .select('id, order_number, customer_id, status')
    .eq('id', orderId)
    .maybeSingle()
  if (error) throw error
  if (!order || order.customer_id !== customerId) {
    throw new Error('Order not found.')
  }
  if (order.status !== 'delivered') {
    const { data: shipment, error: shipmentError } = await admin
      .from('shipments')
      .select('status')
      .eq('order_id', orderId)
      .eq('status', 'delivered')
      .maybeSingle()
    if (shipmentError) throw shipmentError
    if (!shipment) {
      throw new Error('This order has not been delivered yet.')
    }
  }
  return order
}

export interface AccountReviewProduct {
  id: string
  name: string
  slug: string
  image: string | null
}

export interface AccountReviewPageData {
  orderNumber: string
  products: AccountReviewProduct[]
}

export const getOrderReviewProducts = createServerFn({ method: 'GET' })
  .validator(z.object({ orderId: z.string().uuid() }))
  .handler(async ({ data }): Promise<AccountReviewPageData> => {
    const customer = await requireCustomer()
    const admin = getSupabaseAdminClient()
    const order = await requireDeliveredOwnOrder(
      admin,
      customer.id,
      data.orderId,
    )

    const productIds = await distinctOrderProductIds(admin, order.id)
    if (productIds.length === 0) {
      return { orderNumber: order.order_number, products: [] }
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

export const uploadAccountReviewPhoto = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      orderId: z.string().uuid(),
      base64Data: z.string().min(1),
      fileName: z.string().min(1),
      contentType: z.string().min(1),
    }),
  )
  .handler(async ({ data }): Promise<{ url: string }> => {
    const customer = await requireCustomer()
    const admin = getSupabaseAdminClient()
    await requireDeliveredOwnOrder(admin, customer.id, data.orderId)

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

export const submitAccountReviews = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      orderId: z.string().uuid(),
      reviews: z.array(reviewSubmissionItemSchema).min(1),
    }),
  )
  .handler(async ({ data }): Promise<{ success: true }> => {
    const customer = await requireCustomer()
    const admin = getSupabaseAdminClient()
    const order = await requireDeliveredOwnOrder(
      admin,
      customer.id,
      data.orderId,
    )

    const [validProductIds, { data: existing }] = await Promise.all([
      distinctOrderProductIds(admin, order.id).then((ids) => new Set(ids)),
      admin.from('reviews').select('product_id').eq('order_id', order.id),
    ])
    const alreadyReviewed = new Set((existing ?? []).map((r) => r.product_id))

    const rows = data.reviews
      .filter(
        (r) =>
          validProductIds.has(r.productId) && !alreadyReviewed.has(r.productId),
      )
      .map((r) => ({
        product_id: r.productId,
        order_id: order.id,
        customer_email: customer.email,
        customer_name: customer.full_name,
        rating: r.rating,
        review_text: r.reviewText ?? null,
        photo_urls: r.photoUrls,
        status: 'pending' as const,
      }))
    if (rows.length === 0) {
      throw new Error('No valid products left to review for this order.')
    }

    const { error: insertError } = await admin.from('reviews').insert(rows)
    if (insertError) throw insertError

    return { success: true }
  })

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { setReviewStatusSchema } from '#/lib/validation/admin/reviews'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { logStaffActivity } from './activity-log'
import type { Order, Product, Review } from '#/types/entities'

const MANAGE_ROLES = ['super_admin', 'admin', 'manager'] as const

export interface ReviewWithContext extends Review {
  product: Pick<Product, 'id' | 'name' | 'slug'>
  /** Null for imported reviews (see imported_source) — there's no real order behind them. */
  order: Pick<Order, 'id' | 'order_number'> | null
}

const REVIEWS_PAGE_SIZE = 100

const reviewFilterSchema = z.object({
  status: z.string().optional(),
  rating: z.number().int().min(1).max(5).optional(),
})

export const listReviews = createServerFn({ method: 'GET' })
  .validator(
    reviewFilterSchema.extend({
      page: z.number().int().min(1).default(1),
    }),
  )
  .handler(async ({ data }): Promise<ReviewWithContext[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const offset = (data.page - 1) * REVIEWS_PAGE_SIZE
    let query = admin
      .from('reviews')
      .select(
        '*, product:products(id, name, slug), order:orders(id, order_number)',
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + REVIEWS_PAGE_SIZE - 1)
    if (data.status) query = query.eq('status', data.status)
    if (data.rating) query = query.eq('rating', data.rating)

    const { data: reviews, error } = await query
    if (error) throw error
    return reviews
  })

export const getReviewsCount = createServerFn({ method: 'GET' })
  .validator(reviewFilterSchema)
  .handler(async ({ data }): Promise<{ total: number }> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    let query = admin
      .from('reviews')
      .select('id', { count: 'exact', head: true })
    if (data.status) query = query.eq('status', data.status)
    if (data.rating) query = query.eq('rating', data.rating)

    const { count, error } = await query
    if (error) throw error
    return { total: count ?? 0 }
  })

export const setReviewStatus = createServerFn({ method: 'POST' })
  .validator(setReviewStatusSchema)
  .handler(async ({ data }): Promise<Review> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: review, error } = await admin
      .from('reviews')
      .update({ status: data.status })
      .eq('id', data.id)
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(staff, 'review.set_status', 'reviews', review.id, {
      status: data.status,
    })
    return review
  })

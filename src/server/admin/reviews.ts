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
  order: Pick<Order, 'id' | 'order_number'>
}

export const listReviews = createServerFn({ method: 'GET' })
  .validator(z.object({ status: z.string().optional() }))
  .handler(async ({ data }): Promise<ReviewWithContext[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    let query = admin
      .from('reviews')
      .select(
        '*, product:products(id, name, slug), order:orders(id, order_number)',
      )
      .order('created_at', { ascending: false })
    if (data.status) query = query.eq('status', data.status)

    const { data: reviews, error } = await query
    if (error) throw error
    return reviews
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

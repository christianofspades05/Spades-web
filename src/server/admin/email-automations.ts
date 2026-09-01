import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { updateEmailAutomationSchema } from '#/lib/validation/admin/email-automations'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import { storeRangeToUtcBounds } from '#/lib/utils/date-range'
import { fetchAllRows } from '#/lib/utils/paginate'
import { logStaffActivity } from './activity-log'
import type { EmailAutomation } from '#/types/entities'

const MANAGE_ROLES = ['super_admin', 'admin', 'manager'] as const

export interface EmailContact {
  id: string
  email: string
  full_name: string | null
  auth_user_id: string | null
  marketing_opt_in: boolean
  successful_orders_count: number
  created_at: string
}

const CONTACTS_PAGE_SIZE = 100

export interface EmailAutomationWithStats extends EmailAutomation {
  /** Revenue attributed to this automation — every non-cancelled/failed
   *  order placed by a recipient within ATTRIBUTION_WINDOW_DAYS of one of
   *  their sends, all-time. Previously required the order to have actually
   *  used the discount minted for that send, which badly undercounted real
   *  conversions: confirmed live that only ~15% of orders placed by
   *  customers who clicked an abandoned-cart recovery link actually used
   *  the code shown in the email (most used a different code or none at
   *  all), even though the cart itself demonstrably came back and
   *  converted. "Did this recipient buy again soon after" is a much
   *  truer, if still imperfect, signal — not a rigorous last-touch/
   *  first-touch attribution model, and a customer who received more than
   *  one automation's email before buying gets counted under each. Zero
   *  for automations with no matching purchases (yet). */
  attributedOrderCount: number
  attributedRevenueCents: number
  /** Same attribution as attributedOrderCount/attributedRevenueCents above,
   *  but scoped to whatever date range the admin page's picker is set to
   *  (matched against orders.placed_at) — this is "sales of email
   *  marketing" for a chosen month/period, the all-time fields above stay
   *  as the lifetime total regardless of the picker. */
  attributedOrderCountInRange: number
  attributedRevenueCentsInRange: number
  /** From email_sends (0038_email_sends_log.sql) — every successful send
   *  logged by the cron/server-fn send paths. */
  totalSends: number
  sendsInRange: number
  /** post_purchase_review only (null for every other automation, since the
   *  concept doesn't apply) — of the orders that actually got a review
   *  request (orders.review_request_sent), how many have a review row
   *  (reviews.order_id) at all, any status. A direct order-level join, not
   *  the "bought again" proxy above — writing a review is a specific,
   *  unambiguous action, unlike "placed another order," so it doesn't need
   *  a time-window guess. Confirmed live this is a much lower rate (~0.3%)
   *  than the buy-again rate for the same automation (~4.7%) — genuinely
   *  different customer behaviors, not the same thing measured two ways. */
  reviewsWritten: number | null
  reviewRequestsSent: number | null
}

// Fixed set seeded by 0035_email_marketing.sql — this list is never
// created/deleted from the admin UI, only configured, so 'event_type' (a
// stable sort) reads better here than 'created_at' (all 4 rows were created
// in the same migration).
export const listEmailAutomations = createServerFn({ method: 'GET' })
  .validator(z.object({ from: z.string(), to: z.string() }))
  .handler(async ({ data }): Promise<EmailAutomationWithStats[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { start: rangeStart, end: rangeEnd } = storeRangeToUtcBounds(
      data.from,
      data.to,
    )
    const { data: automations, error } = await admin
      .from('email_automations')
      .select('*')
      .order('event_type', { ascending: true })
    if (error) {
      console.error('listEmailAutomations: email_automations query failed:', error)
      throw error
    }

    const automationIds = automations.map((a) => a.id)

    const ATTRIBUTION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

    // Every non-void order's customer email + placed_at + total, all-time
    // — paginated (fetchAllRows), since a plain unbounded select silently
    // caps at PostgREST's 1000-row default once this crosses that (already
    // ~6,900 and climbing). In-memory matching below is cheap at this
    // scale; if it ever becomes a real cost, push this same aggregation
    // into a Postgres RPC instead (see 0077_visitor_analytics_aggregate_
    // functions.sql's get_visitor_totals for the precedent).
    const orders = await fetchAllRows<{
      shipping_address: unknown
      placed_at: string
      total_cents: number
    }>((offset) =>
      admin
        .from('orders')
        .select('shipping_address, placed_at, total_cents')
        .not('status', 'in', '(cancelled,failed)')
        .range(offset, offset + 999),
    )

    const ordersByEmail = new Map<
      string,
      { placedAtMs: number; totalCents: number }[]
    >()
    for (const order of orders) {
      const address = order.shipping_address as { email?: string } | null
      const email = address?.email?.toLowerCase()
      if (!email) continue
      const list = ordersByEmail.get(email) ?? []
      list.push({
        placedAtMs: new Date(order.placed_at).getTime(),
        totalCents: order.total_cents,
      })
      ordersByEmail.set(email, list)
    }
    for (const list of ordersByEmail.values()) {
      list.sort((a, b) => a.placedAtMs - b.placedAtMs)
    }

    // Every logged send across these automations, all-time — same
    // pagination reasoning as orders above (already ~8,700 rows).
    const sends = await fetchAllRows<{
      email_automation_id: string
      recipient_email: string
      sent_at: string
    }>((offset) =>
      admin
        .from('email_sends')
        .select('email_automation_id, recipient_email, sent_at')
        .in('email_automation_id', automationIds)
        .range(offset, offset + 999),
    )

    /** First order (if any) this email placed within ATTRIBUTION_WINDOW_MS
     *  after sentAtMs — see EmailAutomationWithStats' own doc comment for
     *  why this replaced discount-code matching. */
    function firstOrderWithin(email: string, sentAtMs: number) {
      const list = ordersByEmail.get(email.toLowerCase())
      if (!list) return null
      const windowEnd = sentAtMs + ATTRIBUTION_WINDOW_MS
      return (
        list.find((o) => o.placedAtMs >= sentAtMs && o.placedAtMs <= windowEnd) ??
        null
      )
    }

    const rangeStartMs = new Date(rangeStart).getTime()
    const rangeEndMs = new Date(rangeEnd).getTime()
    const statsByAutomationId = new Map<
      string,
      { count: number; revenueCents: number }
    >()
    const statsInRangeByAutomationId = new Map<
      string,
      { count: number; revenueCents: number }
    >()
    for (const send of sends) {
      const sentAtMs = new Date(send.sent_at).getTime()
      const match = firstOrderWithin(send.recipient_email, sentAtMs)
      if (!match) continue

      const existing = statsByAutomationId.get(send.email_automation_id) ?? {
        count: 0,
        revenueCents: 0,
      }
      existing.count += 1
      existing.revenueCents += match.totalCents
      statsByAutomationId.set(send.email_automation_id, existing)

      if (sentAtMs >= rangeStartMs && sentAtMs <= rangeEndMs) {
        const existingInRange = statsInRangeByAutomationId.get(
          send.email_automation_id,
        ) ?? { count: 0, revenueCents: 0 }
        existingInRange.count += 1
        existingInRange.revenueCents += match.totalCents
        statsInRangeByAutomationId.set(send.email_automation_id, existingInRange)
      }
    }

    // Counted straight off the `sends` rows already fetched above — no
    // extra round trip needed now that every send is already in memory
    // for the attribution matching.
    const sendStatsByAutomationId = new Map<
      string,
      { total: number; inRange: number }
    >()
    for (const send of sends) {
      const existing = sendStatsByAutomationId.get(send.email_automation_id) ?? {
        total: 0,
        inRange: 0,
      }
      existing.total += 1
      const sentAtMs = new Date(send.sent_at).getTime()
      if (sentAtMs >= rangeStartMs && sentAtMs <= rangeEndMs) {
        existing.inRange += 1
      }
      sendStatsByAutomationId.set(send.email_automation_id, existing)
    }

    // post_purchase_review only — a direct order-level join (did this
    // specific order, which we know got a review request, ever get a
    // review row) rather than the email-based "bought again" proxy above.
    let reviewsWritten: number | null = null
    let reviewRequestsSent: number | null = null
    const reviewAutomation = automations.find(
      (a) => a.event_type === 'post_purchase_review',
    )
    if (reviewAutomation) {
      const requestedOrders = await fetchAllRows((offset) =>
        admin
          .from('orders')
          .select('id')
          .eq('review_request_sent', true)
          .range(offset, offset + 999),
      )
      reviewRequestsSent = requestedOrders.length
      const requestedOrderIds = new Set(requestedOrders.map((o) => o.id))

      // Wholesale, not filtered by .in(orderIds) — reviews is a small
      // table (low hundreds at most), and orderIds here can be thousands,
      // which risks the same PostgREST .in()-list-too-long problem already
      // hit elsewhere in this codebase. Joining in memory sidesteps it.
      const allReviews = await fetchAllRows((offset) =>
        admin.from('reviews').select('order_id').range(offset, offset + 999),
      )
      reviewsWritten = new Set(
        allReviews
          .map((r) => r.order_id)
          .filter(
            (orderId): orderId is string =>
              orderId !== null && requestedOrderIds.has(orderId),
          ),
      ).size
    }

    return automations.map((automation) => {
      const stats = statsByAutomationId.get(automation.id)
      const statsInRange = statsInRangeByAutomationId.get(automation.id)
      const sendStats = sendStatsByAutomationId.get(automation.id)
      const isReviewAutomation = automation.event_type === 'post_purchase_review'
      return {
        ...automation,
        attributedOrderCount: stats?.count ?? 0,
        attributedRevenueCents: stats?.revenueCents ?? 0,
        attributedOrderCountInRange: statsInRange?.count ?? 0,
        attributedRevenueCentsInRange: statsInRange?.revenueCents ?? 0,
        totalSends: sendStats?.total ?? 0,
        sendsInRange: sendStats?.inRange ?? 0,
        reviewsWritten: isReviewAutomation ? reviewsWritten : null,
        reviewRequestsSent: isReviewAutomation ? reviewRequestsSent : null,
      }
    })
  })

export const getEmailAutomationById = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }): Promise<EmailAutomation | null> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data: automation, error } = await admin
      .from('email_automations')
      .select('*')
      .eq('id', data.id)
      .maybeSingle()
    if (error) throw error
    return automation
  })

export const updateEmailAutomation = createServerFn({ method: 'POST' })
  .validator(updateEmailAutomationSchema)
  .handler(async ({ data }): Promise<EmailAutomation> => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: automation, error } = await admin
      .from('email_automations')
      .update({
        name: data.name,
        is_active: data.isActive,
        subject: data.subject,
        blocks: data.blocks,
        discount_id: data.discountId,
        delay_hours: data.delayHours,
      })
      .eq('id', data.id)
      .select('*')
      .single()
    if (error) throw error

    await logStaffActivity(
      staff,
      'email_automation.update',
      'email_automations',
      automation.id,
      { eventType: automation.event_type },
    )
    return automation
  })

const emailContactFilterSchema = z.object({
  q: z.string().optional(),
  // "Online store" customers = those with a real account (auth_user_id
  // set), as opposed to guest rows auto-created from a marketplace order
  // import (see sync-engine.ts's importOrder) — those never get a
  // storefront account and have no meaningful "opted in to marketing"
  // signal of their own.
  onlineStoreOnly: z.boolean().optional(),
  marketingOptInOnly: z.boolean().optional(),
})

/**
 * A lightweight, purpose-built list for the email marketing "Contacts"
 * section — deliberately separate from admin/customers.ts's listCustomers
 * (a different page, with its own pagination/sort/CSV-export contract) so
 * changes here can't regress that unrelated page.
 */
export const listEmailContacts = createServerFn({ method: 'GET' })
  .validator(
    emailContactFilterSchema.extend({
      page: z.number().int().min(1).default(1),
    }),
  )
  .handler(async ({ data }): Promise<EmailContact[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const offset = (data.page - 1) * CONTACTS_PAGE_SIZE
    let query = admin
      .from('customers')
      .select(
        'id, email, full_name, auth_user_id, marketing_opt_in, successful_orders_count, created_at',
      )
      .not('email', 'ilike', '%@no-email.invalid')
      .not('email', 'ilike', '%@scs2.tiktok.com')
      .order('created_at', { ascending: false })
      .range(offset, offset + CONTACTS_PAGE_SIZE - 1)

    if (data.onlineStoreOnly) query = query.not('auth_user_id', 'is', null)
    if (data.marketingOptInOnly) query = query.eq('marketing_opt_in', true)
    const search = data.q?.trim()
    if (search) {
      query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`)
    }

    const { data: contacts, error } = await query
    if (error) {
      console.error('listEmailContacts: customers query failed:', error)
      throw error
    }
    return contacts
  })

export const getEmailContactsCount = createServerFn({ method: 'GET' })
  .validator(emailContactFilterSchema)
  .handler(async ({ data }): Promise<{ total: number }> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    let query = admin
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .not('email', 'ilike', '%@no-email.invalid')
      .not('email', 'ilike', '%@scs2.tiktok.com')

    if (data.onlineStoreOnly) query = query.not('auth_user_id', 'is', null)
    if (data.marketingOptInOnly) query = query.eq('marketing_opt_in', true)
    const search = data.q?.trim()
    if (search) {
      query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`)
    }

    const { count, error } = await query
    if (error) {
      console.error('getEmailContactsCount: customers query failed:', error)
      throw error
    }
    return { total: count ?? 0 }
  })

// Same signed-upload-URL pattern as storefront-sections.ts's
// createStorefrontSectionUploadUrl — the browser uploads directly to
// Storage (avoiding the serverless body-size cap), this just issues the URL.
export const createEmailImageUploadUrl = createServerFn({ method: 'POST' })
  .validator(z.object({ fileName: z.string() }))
  .handler(
    async ({
      data,
    }): Promise<{ path: string; token: string; publicUrl: string }> => {
      await requireStaff(MANAGE_ROLES)
      const admin = getSupabaseAdminClient()

      const extension = data.fileName.includes('.')
        ? data.fileName.split('.').pop()
        : 'jpg'
      const path = `${crypto.randomUUID()}.${extension}`

      const { data: signed, error } = await admin.storage
        .from('email-images')
        .createSignedUploadUrl(path)
      if (error) throw error

      const { data: publicUrl } = admin.storage
        .from('email-images')
        .getPublicUrl(path)

      return { path, token: signed.token, publicUrl: publicUrl.publicUrl }
    },
  )

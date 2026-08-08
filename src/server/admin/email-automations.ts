import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { updateEmailAutomationSchema } from '#/lib/validation/admin/email-automations'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
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
  /** Revenue attributed to this automation — every non-cancelled/refunded
   *  order using any single-use discount minted from this automation's
   *  template (see lib/email/mint-discount.ts; discounts.email_automation_id
   *  is how a minted clone is tagged), all-time. The automation's own
   *  discount_id is a template, never emailed directly, so it's never itself
   *  used on an order — only its per-recipient clones are. Cheap proxy for
   *  "did this automation drive sales," not a rigorous last-touch/
   *  first-touch attribution model: a customer could still have used the
   *  code without ever having opened this specific email. Zero for
   *  automations with no discount attached, or that haven't sent any minted
   *  codes yet. */
  attributedOrderCount: number
  attributedRevenueCents: number
  /** From email_sends (0038_email_sends_log.sql) — every successful send
   *  logged by the 4 cron/server-fn send paths. */
  totalSends: number
  sendsLast30Days: number
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

// Fixed set seeded by 0035_email_marketing.sql — this list is never
// created/deleted from the admin UI, only configured, so 'event_type' (a
// stable sort) reads better here than 'created_at' (all 4 rows were created
// in the same migration).
export const listEmailAutomations = createServerFn({ method: 'GET' }).handler(
  async (): Promise<EmailAutomationWithStats[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const { data, error } = await admin
      .from('email_automations')
      .select('*')
      .order('event_type', { ascending: true })
    if (error) {
      console.error('listEmailAutomations: email_automations query failed:', error)
      throw error
    }

    const automationIds = data.map((a) => a.id)

    const { data: mintedDiscounts, error: mintedError } = await admin
      .from('discounts')
      .select('id, email_automation_id')
      .in('email_automation_id', automationIds)
    if (mintedError) {
      console.error('listEmailAutomations: discounts query failed:', mintedError)
      throw mintedError
    }

    const automationIdByDiscountId = new Map(
      mintedDiscounts
        .filter(
          (d): d is typeof d & { email_automation_id: string } =>
            d.email_automation_id !== null,
        )
        .map((d) => [d.id, d.email_automation_id]),
    )

    const statsByAutomationId = new Map<
      string,
      { count: number; revenueCents: number }
    >()
    if (automationIdByDiscountId.size > 0) {
      // Filtering in memory (below) against automationIdByDiscountId, rather
      // than passing its keys to .in(), because that id list is every
      // per-recipient minted discount ever sent by any automation —
      // hundreds to low thousands of UUIDs, which blew past PostgREST's
      // request-size limit ("Bad Request") once the welcome automation's
      // send volume grew enough. Only orders that actually used *some*
      // discount are a small, safe set to pull in full instead.
      const { data: orders, error: ordersError } = await admin
        .from('orders')
        .select('discount_id, total_cents')
        .not('discount_id', 'is', null)
        .not('status', 'in', '(cancelled,refunded)')
      if (ordersError) {
        console.error('listEmailAutomations: orders query failed:', ordersError)
        throw ordersError
      }
      for (const order of orders) {
        if (!order.discount_id) continue
        const automationId = automationIdByDiscountId.get(order.discount_id)
        if (!automationId) continue
        const existing = statsByAutomationId.get(automationId) ?? {
          count: 0,
          revenueCents: 0,
        }
        existing.count += 1
        existing.revenueCents += order.total_cents
        statsByAutomationId.set(automationId, existing)
      }
    }

    // Per-automation counts, not a bulk row fetch — fetching every
    // email_sends row to count them in memory silently truncated at
    // PostgREST's default 1000-row response cap once total sends across
    // every automation passed that (3,000+ and climbing), starving every
    // automation's count except whichever one's rows happened to fill that
    // first page. A COUNT query never returns rows, so it isn't subject to
    // that cap regardless of how large the table grows.
    const thirtyDaysAgoISO = new Date(Date.now() - THIRTY_DAYS_MS).toISOString()
    const sendStatsByAutomationId = new Map<
      string,
      { total: number; last30Days: number }
    >()
    await Promise.all(
      automationIds.map(async (automationId) => {
        const [totalResult, last30Result] = await Promise.all([
          admin
            .from('email_sends')
            .select('id', { count: 'exact', head: true })
            .eq('email_automation_id', automationId),
          admin
            .from('email_sends')
            .select('id', { count: 'exact', head: true })
            .eq('email_automation_id', automationId)
            .gte('sent_at', thirtyDaysAgoISO),
        ])
        if (totalResult.error) {
          console.error(
            'listEmailAutomations: email_sends total count failed:',
            totalResult.error,
          )
          throw totalResult.error
        }
        if (last30Result.error) {
          console.error(
            'listEmailAutomations: email_sends 30-day count failed:',
            last30Result.error,
          )
          throw last30Result.error
        }
        sendStatsByAutomationId.set(automationId, {
          total: totalResult.count ?? 0,
          last30Days: last30Result.count ?? 0,
        })
      }),
    )

    return data.map((automation) => {
      const stats = statsByAutomationId.get(automation.id)
      const sendStats = sendStatsByAutomationId.get(automation.id)
      return {
        ...automation,
        attributedOrderCount: stats?.count ?? 0,
        attributedRevenueCents: stats?.revenueCents ?? 0,
        totalSends: sendStats?.total ?? 0,
        sendsLast30Days: sendStats?.last30Days ?? 0,
      }
    })
  },
)

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

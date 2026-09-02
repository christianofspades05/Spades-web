/**
 * Ad-hoc per-order email thread (Admin > Orders > an order > "Emails")
 * — staff sends a one-off message about that specific order (e.g. "your
 * order is delayed 7 days due to a typhoon"), separate from the fixed
 * lifecycle templates in email-automations.ts. Replies land back here via
 * the Resend inbound webhook (src/routes/api/webhooks/resend-inbound.ts) —
 * see that file's header comment for the DNS/dashboard setup it needs.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireStaff } from '#/lib/auth/guards'
import { getSupabaseAdminClient } from '#/lib/supabase/admin'
import {
  inboundReplyToAddress,
  sendEmail,
  withDisplayName,
} from '#/lib/email/resend'
import { orderMessageEmailHtml } from '#/lib/email/templates/order-message'
import { logStaffActivity } from './activity-log'
import type { OrderSource, StaffRole } from '#/types/entities'

const MANAGE_ROLES: StaffRole[] = ['super_admin', 'admin', 'manager', 'packer']

// These sources' "customer email" is a marketplace-generated relay address
// (see the same check in orders.ts's shipment-tracking email) — sending
// here would either bounce or go nowhere real, and a reply couldn't route
// back through it either.
const MARKETPLACE_SOURCES: OrderSource[] = ['tiktok_shop', 'shopee', 'lazada']

export interface OrderEmailMessage {
  id: string
  direction: 'outbound' | 'inbound'
  subject: string
  bodyHtml: string | null
  bodyText: string | null
  fromAddress: string
  toAddress: string
  staffName: string | null
  createdAt: string
  attachments: Array<{
    filename: string
    contentType: string
    size: number
    url: string
  }> | null
}

export const listOrderEmailMessages = createServerFn({ method: 'GET' })
  .validator(z.object({ orderId: z.string().uuid() }))
  .handler(async ({ data }): Promise<OrderEmailMessage[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const { data: rows, error } = await admin
      .from('order_email_messages')
      .select(
        'id, direction, subject, body_html, body_text, from_address, to_address, created_at, attachments, staff:staff_users(full_name)',
      )
      .eq('order_id', data.orderId)
      .order('created_at', { ascending: true })
    if (error) throw error

    // Viewing this order's thread is what "reads" its replies — clears the
    // nav bell's badge for them.
    await admin
      .from('order_email_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('order_id', data.orderId)
      .eq('direction', 'inbound')
      .is('read_at', null)

    return rows.map((row) => ({
      id: row.id,
      direction: row.direction,
      subject: row.subject,
      bodyHtml: row.body_html,
      bodyText: row.body_text,
      fromAddress: row.from_address,
      toAddress: row.to_address,
      staffName: row.staff?.full_name ?? null,
      createdAt: row.created_at,
      attachments: row.attachments,
    }))
  })

/** Cheap poll target for the admin nav bell's badge count — admin.tsx calls
 *  this every 30s. The dropdown's actual content comes from
 *  listCustomerReplies below, fetched only when it's opened. */
export const getUnreadCustomerReplyCount = createServerFn({
  method: 'GET',
}).handler(async (): Promise<number> => {
  await requireStaff()
  const admin = getSupabaseAdminClient()

  const { count, error } = await admin
    .from('order_email_messages')
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'inbound')
    .is('read_at', null)
  if (error) throw error
  return count ?? 0
})

export interface CustomerReply {
  id: string
  orderId: string
  orderNumber: string
  bodyText: string | null
  createdAt: string
  read: boolean
}

const CUSTOMER_REPLIES_PAGE_SIZE = 10

/** Full history of customer replies (not just unread) for the admin nav
 *  bell's dropdown, newest first — a read reply stays visible here even
 *  after listOrderEmailMessages marks it read, it just renders muted
 *  instead of disappearing. */
export const listCustomerReplies = createServerFn({ method: 'GET' })
  .validator(z.object({ page: z.number().int().min(1).default(1) }))
  .handler(async ({ data }): Promise<{
    items: CustomerReply[]
    total: number
  }> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()
    const offset = (data.page - 1) * CUSTOMER_REPLIES_PAGE_SIZE

    const [{ count, error: countError }, { data: rows, error: rowsError }] =
      await Promise.all([
        admin
          .from('order_email_messages')
          .select('id', { count: 'exact', head: true })
          .eq('direction', 'inbound'),
        admin
          .from('order_email_messages')
          .select(
            'id, order_id, body_text, created_at, read_at, order:orders(order_number)',
          )
          .eq('direction', 'inbound')
          .order('created_at', { ascending: false })
          .range(offset, offset + CUSTOMER_REPLIES_PAGE_SIZE - 1),
      ])
    if (countError) throw countError
    if (rowsError) throw rowsError

    return {
      total: count ?? 0,
      items: rows.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        orderNumber: row.order.order_number,
        bodyText: row.body_text,
        createdAt: row.created_at,
        read: row.read_at !== null,
      })),
    }
  })

export const sendOrderEmail = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      orderId: z.string().uuid(),
      subject: z.string().min(1).max(200),
      message: z.string().min(1).max(5000),
    }),
  )
  .handler(async ({ data }) => {
    const staff = await requireStaff(MANAGE_ROLES)
    const admin = getSupabaseAdminClient()

    const { data: order, error } = await admin
      .from('orders')
      .select('order_number, source, customer:customers(email)')
      .eq('id', data.orderId)
      .maybeSingle()
    if (error) throw error
    if (!order) throw new Error('Order not found')
    if (MARKETPLACE_SOURCES.includes(order.source)) {
      throw new Error(
        `Can't email this order's customer directly — its contact is a ${order.source} relay address, not the buyer's real inbox. Message them through the marketplace's own chat instead.`,
      )
    }

    const from = withDisplayName(
      'Spades Official Orders',
      process.env.RESEND_FROM_EMAIL_ORDERS,
    )
    const html = orderMessageEmailHtml({
      orderNumber: order.order_number,
      message: data.message,
    })

    const sent = await sendEmail({
      to: order.customer.email,
      subject: data.subject,
      html,
      from,
      replyTo: inboundReplyToAddress(data.orderId),
    })

    const { error: insertError } = await admin
      .from('order_email_messages')
      .insert({
        order_id: data.orderId,
        direction: 'outbound',
        subject: data.subject,
        body_html: html,
        body_text: data.message,
        from_address: from ?? process.env.RESEND_FROM_EMAIL ?? '',
        to_address: order.customer.email,
        resend_email_id: sent.id,
        staff_user_id: staff.id,
      })
    if (insertError) throw insertError

    await logStaffActivity(staff, 'order.send_email', 'orders', data.orderId, {
      subject: data.subject,
    })
  })

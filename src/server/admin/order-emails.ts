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
import { sendEmail, withDisplayName } from '#/lib/email/resend'
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
}

export const listOrderEmailMessages = createServerFn({ method: 'GET' })
  .validator(z.object({ orderId: z.string().uuid() }))
  .handler(async ({ data }): Promise<OrderEmailMessage[]> => {
    await requireStaff()
    const admin = getSupabaseAdminClient()

    const { data: rows, error } = await admin
      .from('order_email_messages')
      .select(
        'id, direction, subject, body_html, body_text, from_address, to_address, created_at, staff:staff_users(full_name)',
      )
      .eq('order_id', data.orderId)
      .order('created_at', { ascending: true })
    if (error) throw error

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
    }))
  })

/** Null until ORDER_EMAIL_INBOUND_DOMAIN is configured (see
 *  resend-inbound.ts's setup steps) — sendOrderEmail() still sends fine
 *  without it, just without a Reply-To, so a reply goes to the plain
 *  from-address instead of back into this thread. */
function inboundReplyToAddress(orderId: string): string | undefined {
  const domain = process.env.ORDER_EMAIL_INBOUND_DOMAIN
  return domain ? `order-${orderId}@${domain}` : undefined
}

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

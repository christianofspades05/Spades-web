/**
 * Resend inbound-email webhook (`email.received`) — the other half of the
 * order-emails thread on the admin order detail page (see
 * src/server/admin/order-emails.ts for the outbound send, which sets the
 * order's unique `order-<orderId>@<inbound domain>` address as Reply-To).
 *
 * Setup this route needs OUTSIDE this codebase before it does anything —
 * none of this is configurable from here:
 *   1. In Resend, add the inbound domain (e.g. reply.spades-official.com —
 *      a dedicated subdomain, not the root domain, so this never competes
 *      with real business email on spades-official.com's own MX) and add
 *      the MX record it gives you to that subdomain in your DNS provider.
 *   2. In Resend > Webhooks, add an endpoint pointing at this route's full
 *      URL, subscribed to the `email.received` event, and copy its signing
 *      secret into Vercel as RESEND_WEBHOOK_SECRET.
 *   3. Set ORDER_EMAIL_INBOUND_DOMAIN in Vercel to that same subdomain —
 *      sendOrderEmail() won't set a Reply-To (so replies just go to the
 *      normal from-address) until this is set.
 *
 * Verifies Resend's Svix-signed webhook (svix-id/svix-timestamp/
 * svix-signature headers against RESEND_WEBHOOK_SECRET) before trusting
 * anything in the body — same never-trust-an-unverified-webhook principle
 * as xendit.ts. The event payload itself is metadata-only (no body); the
 * full message has to be fetched separately from Resend's Received Emails
 * API using the email id it gives us.
 */
import { createFileRoute } from '@tanstack/react-router'

const ORDER_REPLY_ADDRESS_PATTERN =
  /^order-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@/i

async function verifySvixSignature(
  secret: string,
  id: string,
  timestamp: string,
  rawBody: string,
  signatureHeader: string,
): Promise<boolean> {
  const { createHmac, timingSafeEqual } = await import('node:crypto')
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const signedContent = `${id}.${timestamp}.${rawBody}`
  const expected = Buffer.from(
    createHmac('sha256', secretBytes).update(signedContent).digest('base64'),
  )
  return signatureHeader.split(' ').some((part) => {
    const sig = part.split(',')[1]
    if (!sig) return false
    const sigBuf = Buffer.from(sig)
    return sigBuf.length === expected.length && timingSafeEqual(sigBuf, expected)
  })
}

interface ResendInboundPayload {
  type: string
  data: {
    email_id: string
    to: string[]
    received_for?: string[]
    from: string
    subject: string
  }
}

interface ResendReceivedEmail {
  html: string | null
  text: string | null
  from: string
  subject: string
}

export const Route = createFileRoute('/api/webhooks/resend-inbound')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.RESEND_WEBHOOK_SECRET
        const svixId = request.headers.get('svix-id')
        const svixTimestamp = request.headers.get('svix-timestamp')
        const svixSignature = request.headers.get('svix-signature')
        const rawBody = await request.text()

        if (
          !secret ||
          !svixId ||
          !svixTimestamp ||
          !svixSignature ||
          !(await verifySvixSignature(
            secret,
            svixId,
            svixTimestamp,
            rawBody,
            svixSignature,
          ))
        ) {
          return new Response('Invalid signature', { status: 401 })
        }

        const payload = JSON.parse(rawBody) as ResendInboundPayload
        if (payload.type !== 'email.received') {
          return Response.json({ received: true })
        }

        // The order id is encoded in whichever address this was actually
        // delivered to — `received_for` reflects the true final recipient
        // more reliably than `to` (which is just what the sender's client
        // put in the To: header) when the domain is a plain catch-all.
        const candidateAddresses = [
          ...(payload.data.received_for ?? []),
          ...payload.data.to,
        ]
        const orderId = candidateAddresses
          .map((addr) => ORDER_REPLY_ADDRESS_PATTERN.exec(addr)?.[1])
          .find((id): id is string => Boolean(id))

        if (!orderId) {
          // Not an order reply we can route anywhere — nothing to do, but
          // still 200 so Resend doesn't keep retrying an event we'll never
          // be able to act on.
          return Response.json({ received: true })
        }

        const { getSupabaseAdminClient } = await import('#/lib/supabase/admin')
        const admin = getSupabaseAdminClient()

        const { data: order } = await admin
          .from('orders')
          .select('id')
          .eq('id', orderId)
          .maybeSingle()
        if (!order) {
          return Response.json({ received: true })
        }

        const apiKey = process.env.RESEND_API_KEY
        if (!apiKey) {
          return new Response('Missing RESEND_API_KEY', { status: 500 })
        }
        const detailRes = await fetch(
          `https://api.resend.com/emails/receiving/${payload.data.email_id}`,
          { headers: { Authorization: `Bearer ${apiKey}` } },
        )
        if (!detailRes.ok) {
          throw new Error(
            `Resend receiving-email fetch failed (${detailRes.status}): ${await detailRes.text()}`,
          )
        }
        const detail = (await detailRes.json()) as ResendReceivedEmail

        // resend_email_id has a partial unique index — a retried webhook
        // delivery for the same email hits a 23505 conflict here, which is
        // treated as already-handled rather than a real failure.
        const { error } = await admin.from('order_email_messages').insert({
          order_id: orderId,
          direction: 'inbound',
          subject: detail.subject,
          body_html: detail.html,
          body_text: detail.text,
          from_address: detail.from,
          to_address: payload.data.to[0] ?? '',
          resend_email_id: payload.data.email_id,
        })
        if (error && error.code !== '23505') throw error

        return Response.json({ received: true })
      },
    },
  },
})

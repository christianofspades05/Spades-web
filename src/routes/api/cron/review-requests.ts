/**
 * Daily cron target: emails a review-request link for every order that's
 * old enough and hasn't been emailed yet. Trigger it with a scheduler
 * (Vercel Cron, cron-job.org, a GitHub Action, etc.) sending
 * `Authorization: Bearer $CRON_SECRET`.
 *
 * The match condition is "review_request_sent = false AND placed_at at
 * least 14 days ago" rather than "placed_at exactly 14 days ago" — the
 * spec's literal wording would silently skip an order forever if a single
 * day's send failed (a network blip, Resend being down), since by the next
 * run that order would be 15 days old and fall outside an exact-day match.
 * With an open-ended lower bound, a failed order simply gets retried on the
 * next run, since review_request_sent only gets set to true after the email
 * actually sends successfully.
 */
import { createFileRoute } from '@tanstack/react-router'
import { generateReviewToken } from '#/lib/utils/review-token'
import {
  REVIEW_REQUEST_EMAIL_SUBJECT,
  reviewRequestEmailHtml,
} from '#/lib/email/templates/review-request'
import type { OrderShippingAddress } from '#/lib/checkout/shipping-address'

// getSupabaseAdminClient and sendEmail are imported dynamically inside the
// handler below, not at the top level — routeTree.gen.ts imports every
// route file (including this one) eagerly for the client's route tree, and
// unlike createServerFn, a `server.handlers` route doesn't get its
// server-only code split out of the client bundle automatically. A
// top-level import here would run admin.ts's and resend.ts's browser guards
// in every visitor's browser.

const REVIEW_REQUEST_DELAY_DAYS = 14
const REVIEW_TOKEN_VALID_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('CRON_SECRET is not set — rejecting all cron requests.')
    return false
  }
  return request.headers.get('authorization') === `Bearer ${expected}`
}

export const Route = createFileRoute('/api/cron/review-requests')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthorized(request)) {
          return new Response('Unauthorized', { status: 401 })
        }

        const siteUrl = process.env.SITE_URL
        if (!siteUrl) {
          return Response.json(
            { error: 'SITE_URL is not configured' },
            { status: 500 },
          )
        }

        const { getSupabaseAdminClient } = await import('#/lib/supabase/admin')
        const { sendEmail } = await import('#/lib/email/resend')
        const admin = getSupabaseAdminClient()
        const cutoff = new Date(
          Date.now() - REVIEW_REQUEST_DELAY_DAYS * DAY_MS,
        ).toISOString()

        const { data: orders, error } = await admin
          .from('orders')
          .select('id, order_number, shipping_address')
          .eq('review_request_sent', false)
          .not('status', 'in', '(cancelled,refunded)')
          .lte('placed_at', cutoff)
        if (error) throw error

        let sent = 0
        const failures: { orderId: string; error: string }[] = []

        for (const order of orders) {
          try {
            const { data: items, error: itemsError } = await admin
              .from('order_items')
              .select('variant_id')
              .eq('order_id', order.id)
            if (itemsError) throw itemsError

            const variantIds = Array.from(
              new Set(
                items.map((i) => i.variant_id).filter((v): v is string => !!v),
              ),
            )

            if (variantIds.length === 0) {
              // Nothing left to review (e.g. every line item's variant was
              // since deleted) — mark it sent so it isn't retried forever.
              await admin
                .from('orders')
                .update({
                  review_request_sent: true,
                  review_requested_at: new Date().toISOString(),
                })
                .eq('id', order.id)
              continue
            }

            const { data: variants, error: variantsError } = await admin
              .from('product_variants')
              .select('product_id, product:products(name, images)')
              .in('id', variantIds)
            if (variantsError) throw variantsError

            const productsById = new Map<
              string,
              { name: string; image: string | null }
            >()
            for (const v of variants) {
              if (!productsById.has(v.product_id)) {
                productsById.set(v.product_id, {
                  name: v.product.name,
                  image: v.product.images[0] ?? null,
                })
              }
            }

            const token = generateReviewToken()
            const address =
              order.shipping_address as unknown as OrderShippingAddress

            await sendEmail({
              to: address.email,
              subject: REVIEW_REQUEST_EMAIL_SUBJECT,
              html: reviewRequestEmailHtml({
                customerName: address.recipientName,
                orderNumber: order.order_number,
                reviewUrl: `${siteUrl}/review/${token}`,
                items: Array.from(productsById.values()),
              }),
            })

            // Only persist the token / mark it sent once the email has
            // actually gone out — if sendEmail throws above, this order is
            // untouched and gets a fresh token on the next run instead.
            const { error: updateError } = await admin
              .from('orders')
              .update({
                review_token: token,
                review_token_expires_at: new Date(
                  Date.now() + REVIEW_TOKEN_VALID_DAYS * DAY_MS,
                ).toISOString(),
                review_requested_at: new Date().toISOString(),
                review_request_sent: true,
              })
              .eq('id', order.id)
            if (updateError) throw updateError

            sent += 1
          } catch (err) {
            failures.push({
              orderId: order.id,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        return Response.json({ scanned: orders.length, sent, failures })
      },
    },
  },
})

/**
 * Abandoned-cart reminder. Trigger via an external scheduler (cron-job.org,
 * recommended hourly) sending `Authorization: Bearer $CRON_SECRET` — NOT
 * added to vercel.json's cron list, which is already at this Vercel plan's
 * 2-daily-cron cap (review-requests, sync-channels-daily).
 */
import { createFileRoute } from '@tanstack/react-router'
import { randomBytes } from 'node:crypto'
import {
  ABANDONED_CART_EMAIL_SUBJECT,
  abandonedCartEmailHtml,
} from '#/lib/email/templates/abandoned-cart'

// getSupabaseAdminClient and sendEmail are imported dynamically inside the
// handler below, not at the top level — see review-requests.ts's identical
// comment. A `server.handlers` route doesn't get server-only code split
// out of the client bundle the way createServerFn does; a top-level import
// here would leak RESEND_API_KEY-touching code into every visitor's
// browser bundle.

const INACTIVITY_THRESHOLD_MS = 60 * 60 * 1000 // 1 hour

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('CRON_SECRET is not set — rejecting all cron requests.')
    return false
  }
  return request.headers.get('authorization') === `Bearer ${expected}`
}

function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

export const Route = createFileRoute('/api/cron/abandoned-cart')({
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

        const cutoffMs = Date.now() - INACTIVITY_THRESHOLD_MS
        const cutoffISO = new Date(cutoffMs).toISOString()

        // Coarse filter: any cart that COULD qualify. created_at <= cutoff
        // is a valid lower-bound proxy — no cart_items row can predate its
        // parent cart, so a cart created after the cutoff cannot possibly
        // have been inactive long enough yet, regardless of item activity.
        const [
          { data: carts, error: cartsError },
          { data: unsubs, error: unsubError },
        ] = await Promise.all([
          admin
            .from('carts')
            .select('id, session_token, email, updated_at')
            .eq('status', 'active')
            .eq('abandoned_cart_email_sent', false)
            .not('email', 'is', null)
            .lte('created_at', cutoffISO),
          admin.from('email_unsubscribes').select('email'),
        ])
        if (cartsError) throw cartsError
        if (unsubError) throw unsubError

        const unsubscribed = new Set(unsubs.map((u) => u.email))

        let sent = 0
        let skipped = 0
        const failures: { cartId: string; error: string }[] = []

        for (const cart of carts) {
          if (!cart.email || unsubscribed.has(cart.email)) {
            skipped += 1
            continue
          }

          try {
            const { data: items, error: itemsError } = await admin
              .from('cart_items')
              .select('variant_id, quantity, price_cents_snapshot, updated_at')
              .eq('cart_id', cart.id)
            if (itemsError) throw itemsError

            if (items.length === 0) {
              // Nothing to remind them of yet — don't mark sent, they may
              // add items later and become a real candidate.
              skipped += 1
              continue
            }

            // carts.updated_at alone doesn't reflect item changes (cart_items
            // has its own separate updated_at trigger that never propagates
            // to the parent cart), so real "last activity" needs both.
            const lastActivityMs = Math.max(
              new Date(cart.updated_at).getTime(),
              ...items.map((i) => new Date(i.updated_at).getTime()),
            )
            if (lastActivityMs > cutoffMs) {
              // The coarse filter only guaranteed the cart is old enough to
              // have been created before the cutoff, not that it's been
              // quiet since — an item added recently means it's not
              // actually abandoned yet.
              skipped += 1
              continue
            }

            const variantIds = Array.from(
              new Set(items.map((i) => i.variant_id)),
            )
            const { data: variants, error: variantsError } = await admin
              .from('product_variants')
              .select('id, size, color, style, product:products(name, images)')
              .in('id', variantIds)
            if (variantsError) throw variantsError

            const variantsById = new Map(variants.map((v) => [v.id, v]))
            const lineItems = items.map((item) => {
              const v = variantsById.get(item.variant_id)
              const variantLabel = v
                ? [v.size, v.color, v.style].filter(Boolean).join(' / ') ||
                  null
                : null
              return {
                name: v?.product.name ?? 'Item',
                variantLabel,
                image: v?.product.images[0] ?? null,
                quantity: item.quantity,
                lineTotalCents: item.quantity * item.price_cents_snapshot,
              }
            })
            const subtotalCents = lineItems.reduce(
              (sum, i) => sum + i.lineTotalCents,
              0,
            )

            const recoveryToken = generateToken()
            const unsubscribeToken = generateToken()

            await sendEmail({
              to: cart.email,
              subject: ABANDONED_CART_EMAIL_SUBJECT,
              html: abandonedCartEmailHtml({
                items: lineItems,
                subtotalCents,
                resumeUrl: `${siteUrl}/cart/resume/${recoveryToken}`,
                unsubscribeUrl: `${siteUrl}/unsubscribe/${unsubscribeToken}`,
              }),
            })

            // Only persist the tokens / mark it sent once the email has
            // actually gone out — if sendEmail throws above, this cart is
            // untouched and gets a fresh attempt on the next run instead.
            const { error: updateError } = await admin
              .from('carts')
              .update({
                recovery_token: recoveryToken,
                unsubscribe_token: unsubscribeToken,
                abandoned_cart_email_sent: true,
                abandoned_cart_emailed_at: new Date().toISOString(),
              })
              .eq('id', cart.id)
            if (updateError) throw updateError

            sent += 1
          } catch (err) {
            failures.push({
              cartId: cart.id,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        return Response.json({ scanned: carts.length, sent, skipped, failures })
      },
    },
  },
})

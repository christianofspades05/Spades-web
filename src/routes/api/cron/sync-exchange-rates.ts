/**
 * Refreshes the exchange_rates table daily, used by the storefront's
 * display-currency selector and, for card payments, the actual amount
 * charged via Xendit. Trigger via an external scheduler (cron-job.org,
 * daily) sending `Authorization: Bearer $CRON_SECRET` — NOT added to
 * vercel.json's cron list, which is already at this Vercel plan's
 * 2-daily-cron cap (review-requests, sync-channels-daily) — same reasoning
 * as api/cron/abandoned-cart.ts.
 *
 * Source: open.er-api.com — free, keyless, and (unlike ECB-based
 * Frankfurter) covers VND, which the storefront's currency list needs.
 * Confirmed live: `GET https://open.er-api.com/v6/latest/PHP` returns
 * `{ result: "success", rates: { USD, EUR, SGD, HKD, MYR, THB, VND, JPY,
 * MOP, ... } }`.
 */
import { createFileRoute } from '@tanstack/react-router'

const SUPPORTED_CURRENCIES = [
  'USD',
  'EUR',
  'SGD',
  'HKD',
  'MYR',
  'THB',
  'VND',
  'JPY',
  'MOP',
  'KRW',
] as const

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    console.error('CRON_SECRET is not set — rejecting all cron requests.')
    return false
  }
  return request.headers.get('authorization') === `Bearer ${expected}`
}

interface OpenErApiResponse {
  result: string
  rates: Record<string, number>
}

export const Route = createFileRoute('/api/cron/sync-exchange-rates')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthorized(request)) {
          return new Response('Unauthorized', { status: 401 })
        }

        const { getSupabaseAdminClient } = await import('#/lib/supabase/admin')
        const admin = getSupabaseAdminClient()

        const res = await fetch('https://open.er-api.com/v6/latest/PHP')
        if (!res.ok) {
          return Response.json(
            { error: `Rate API HTTP ${res.status}` },
            { status: 502 },
          )
        }
        const body = (await res.json()) as OpenErApiResponse
        if (body.result !== 'success') {
          return Response.json(
            { error: `Rate API returned result=${body.result}` },
            { status: 502 },
          )
        }

        const rows = SUPPORTED_CURRENCIES.filter(
          (currency) => typeof body.rates[currency] === 'number',
        ).map((currency) => ({
          currency,
          rate_to_php: body.rates[currency],
          updated_at: new Date().toISOString(),
        }))

        const missing = SUPPORTED_CURRENCIES.filter(
          (currency) => typeof body.rates[currency] !== 'number',
        )

        const { error } = await admin
          .from('exchange_rates')
          .upsert(rows, { onConflict: 'currency' })
        if (error) throw error

        return Response.json({ updated: rows.map((r) => r.currency), missing })
      },
    },
  },
})

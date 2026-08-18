/**
 * Server-only Xendit API client. Two separate secret keys are used, scoped
 * by permission (least-privilege — see .env.example): WRITE for creating
 * invoices, READ for checking their status.
 *
 * Never import this from a route component or anything that could end up
 * in the browser bundle. Each exported function guards itself at call time
 * (not at module top-level) — a throw-on-import would crash the whole
 * page's hydration if this module ever ends up merely *imported* into a
 * client bundle by accident, even without any function being called.
 */
function assertServerOnly() {
  if (typeof window !== 'undefined') {
    throw new Error(
      'lib/xendit/client.ts was called from a browser context. Xendit secret keys must never run client-side.',
    )
  }
}

const XENDIT_API_BASE = 'https://api.xendit.co'

export interface XenditInvoice {
  id: string
  external_id: string
  status: string
  invoice_url: string
  amount: number
  currency: string
}

function basicAuthHeader(secretKey: string): string {
  return `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing ${name}. Check your .env file against .env.example.`,
    )
  }
  return value
}

export interface CreateInvoiceInput {
  externalId: string
  /** Major units (not minor/cents) of `currency` — e.g. pesos for PHP,
   *  dollars for USD. */
  amount: number
  /** ISO 4217 currency code. GCash/Maya/bank transfer are Philippine-only
   *  rails that cannot settle outside PHP, so any non-'PHP' currency here
   *  restricts the hosted invoice page to card payment only — see
   *  https://docs.xendit.co/docs/card-multi-currency-processing. That doc
   *  currently lists Payment Session / Xendit Components / Payments API
   *  (v3) as the supported integrations for multi-currency card
   *  processing, NOT this legacy Invoice API — passing a non-PHP currency
   *  here is unverified against Xendit's live behavior for this endpoint
   *  and may be rejected. Treat any resulting error as a real failure
   *  (place-order.ts already rolls back the order/reservation on invoice
   *  creation failure) — never silently fall back to charging PHP while
   *  telling the customer they were charged in their selected currency.
   */
  currency: string
  payerEmail: string
  description: string
  successRedirectUrl: string
  failureRedirectUrl: string
  /** Seconds until the invoice auto-expires (Xendit pushes an `EXPIRED`
   *  webhook event at that point — see xendit.ts). Omit for Xendit's own
   *  default (commonly 24h). */
  invoiceDuration?: number
}

export async function createXenditInvoice(
  input: CreateInvoiceInput,
): Promise<XenditInvoice> {
  assertServerOnly()
  const secretKey = requireEnv('XENDIT_SECRET_KEY_WRITE')

  const res = await fetch(`${XENDIT_API_BASE}/v2/invoices`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(secretKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      external_id: input.externalId,
      amount: input.amount,
      payer_email: input.payerEmail,
      description: input.description,
      currency: input.currency,
      ...(input.currency !== 'PHP' ? { payment_methods: ['CARDS'] } : {}),
      success_redirect_url: input.successRedirectUrl,
      failure_redirect_url: input.failureRedirectUrl,
      ...(input.invoiceDuration !== undefined
        ? { invoice_duration: input.invoiceDuration }
        : {}),
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Xendit invoice creation failed (${res.status}): ${body}`)
  }

  return res.json()
}

export async function getXenditInvoice(
  invoiceId: string,
): Promise<XenditInvoice> {
  assertServerOnly()
  const secretKey = requireEnv('XENDIT_SECRET_KEY_READ')

  const res = await fetch(`${XENDIT_API_BASE}/v2/invoices/${invoiceId}`, {
    headers: { Authorization: basicAuthHeader(secretKey) },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Xendit invoice lookup failed (${res.status}): ${body}`)
  }

  return res.json()
}

/** Compares the x-callback-token header Xendit sends on every webhook against our configured verification token. */
export function isValidXenditWebhookToken(headerToken: string | null): boolean {
  assertServerOnly()
  const expected = process.env.XENDIT_WEBHOOK_VERIFICATION_TOKEN
  if (!expected) {
    console.error(
      'XENDIT_WEBHOOK_VERIFICATION_TOKEN is not set — rejecting all Xendit webhooks. Set it in .env (see .env.example).',
    )
    return false
  }
  return headerToken === expected
}

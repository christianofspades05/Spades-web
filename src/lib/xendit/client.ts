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
  amountPesos: number
  payerEmail: string
  description: string
  successRedirectUrl: string
  failureRedirectUrl: string
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
      amount: input.amountPesos,
      payer_email: input.payerEmail,
      description: input.description,
      currency: 'PHP',
      success_redirect_url: input.successRedirectUrl,
      failure_redirect_url: input.failureRedirectUrl,
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

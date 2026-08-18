/**
 * Server-only Xendit API client. Two separate secret keys are used per
 * account, scoped by permission (least-privilege — see .env.example): WRITE
 * for creating invoices, READ for checking their status.
 *
 * Multiple Xendit *accounts* (not just keys) are supported — a stopgap
 * while the main account's multi-currency approval is still pending (see
 * place-order.ts). The main account only has PHP enabled; a country whose
 * customers need a different settlement currency can be routed to a
 * separate Xendit account that has that currency enabled instead. See
 * XENDIT_ACCOUNTS/resolveXenditAccountId below.
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

export type XenditAccountId = 'default' | 'sgd'

interface XenditAccountConfig {
  currency: string
  writeKeyEnv: string
  readKeyEnv: string
  webhookTokenEnv: string
}

const XENDIT_ACCOUNTS: Record<XenditAccountId, XenditAccountConfig> = {
  default: {
    currency: 'PHP',
    writeKeyEnv: 'XENDIT_SECRET_KEY_WRITE',
    readKeyEnv: 'XENDIT_SECRET_KEY_READ',
    webhookTokenEnv: 'XENDIT_WEBHOOK_VERIFICATION_TOKEN',
  },
  sgd: {
    currency: 'SGD',
    writeKeyEnv: 'XENDIT_SECRET_KEY_WRITE_SGD',
    readKeyEnv: 'XENDIT_SECRET_KEY_READ_SGD',
    webhookTokenEnv: 'XENDIT_WEBHOOK_VERIFICATION_TOKEN_SGD',
  },
}

/** Checkout country -> which Xendit account actually charges the
 *  customer. Anything not listed here uses 'default' (PHP) — the same
 *  behavior as before this account-routing existed. */
const COUNTRY_XENDIT_ACCOUNT: Partial<Record<string, XenditAccountId>> = {
  SG: 'sgd',
}

export function resolveXenditAccountId(country: string): XenditAccountId {
  return COUNTRY_XENDIT_ACCOUNT[country] ?? 'default'
}

export function xenditAccountCurrency(account: XenditAccountId): string {
  return XENDIT_ACCOUNTS[account].currency
}

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
  account: XenditAccountId,
  input: CreateInvoiceInput,
): Promise<XenditInvoice> {
  assertServerOnly()
  const secretKey = requireEnv(XENDIT_ACCOUNTS[account].writeKeyEnv)

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
  account: XenditAccountId,
  invoiceId: string,
): Promise<XenditInvoice> {
  assertServerOnly()
  const secretKey = requireEnv(XENDIT_ACCOUNTS[account].readKeyEnv)

  const res = await fetch(`${XENDIT_API_BASE}/v2/invoices/${invoiceId}`, {
    headers: { Authorization: basicAuthHeader(secretKey) },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Xendit invoice lookup failed (${res.status}): ${body}`)
  }

  return res.json()
}

/** Compares the x-callback-token header Xendit sends on every webhook
 *  against every configured account's verification token — each Xendit
 *  account issues its own distinct token, so a single fixed comparison
 *  would reject every account but one. Returns which account the webhook
 *  came from (null if it matches none, i.e. invalid/forged). An account
 *  whose webhook token isn't configured (e.g. the SGD account not yet set
 *  up in a given environment) is simply never matched, not an error —
 *  only the default account's token is required to exist. */
export function isValidXenditWebhookToken(
  headerToken: string | null,
): XenditAccountId | null {
  assertServerOnly()
  if (!headerToken) return null

  for (const [id, config] of Object.entries(XENDIT_ACCOUNTS) as [
    XenditAccountId,
    XenditAccountConfig,
  ][]) {
    const expected = process.env[config.webhookTokenEnv]
    if (expected && headerToken === expected) return id
  }

  if (!process.env[XENDIT_ACCOUNTS.default.webhookTokenEnv]) {
    console.error(
      'XENDIT_WEBHOOK_VERIFICATION_TOKEN is not set — rejecting all Xendit webhooks. Set it in .env (see .env.example).',
    )
  }
  return null
}

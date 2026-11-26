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

// ---------------------------------------------------------------------------
// Payment Sessions (the newer hosted checkout — the only one Xendit
// documents Apple Pay on: https://docs.xendit.co/docs/apple-pay). Which
// system new checkouts use is chosen by XENDIT_CHECKOUT_MODE (see
// xenditCheckoutMode below); both stay readable so payments started under
// either one always complete. Session ids start with "ps-", invoice ids
// never do — that's how the shared lookups below tell them apart, and why
// the same `xendit_invoice_id` columns can hold either.
// ---------------------------------------------------------------------------

export interface XenditPaymentSession {
  payment_session_id: string
  reference_id: string
  status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'CANCELED'
  payment_link_url: string
  amount: number
  currency: string
  payment_id?: string | null
  payment_request_id?: string | null
}

/** 'sessions' only when explicitly turned on — anything else (unset
 *  included) keeps the legacy Invoice checkout, so the switch can be
 *  flipped back instantly from Vercel's env settings. */
export function xenditCheckoutMode(): 'sessions' | 'invoice' {
  return process.env.XENDIT_CHECKOUT_MODE === 'sessions'
    ? 'sessions'
    : 'invoice'
}

export function isXenditSessionId(id: string): boolean {
  return id.startsWith('ps-')
}

/** Xendit rejects a session expiring sooner than 10 minutes from creation
 *  (invoices allowed 5) — a little over that, for clock skew. */
export const XENDIT_SESSION_MIN_LIFETIME_SECONDS = 10 * 60 + 30

export interface CreatePaymentSessionInput {
  /** Our id — a checkout_reservations or event_registrations id. */
  referenceId: string
  /** Major units of PHP (pesos). */
  amount: number
  description: string
  successReturnUrl: string
  cancelReturnUrl: string
  /** Seconds until the session expires; clamped to Xendit's minimum. */
  expiresInSeconds: number
}

export async function createXenditPaymentSession(
  input: CreatePaymentSessionInput,
): Promise<XenditPaymentSession> {
  assertServerOnly()
  const secretKey = requireEnv('XENDIT_SECRET_KEY_WRITE')
  const lifetime = Math.max(
    input.expiresInSeconds,
    XENDIT_SESSION_MIN_LIFETIME_SECONDS,
  )

  const res = await fetch(`${XENDIT_API_BASE}/sessions`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(secretKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reference_id: input.referenceId,
      session_type: 'PAY',
      mode: 'PAYMENT_LINK',
      amount: input.amount,
      currency: 'PHP',
      country: 'PH',
      description: input.description,
      success_return_url: input.successReturnUrl,
      cancel_return_url: input.cancelReturnUrl,
      expires_at: new Date(Date.now() + lifetime * 1000).toISOString(),
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(
      `Xendit payment session creation failed (${res.status}): ${body}`,
    )
  }

  return res.json()
}

export async function getXenditPaymentSession(
  sessionId: string,
): Promise<XenditPaymentSession> {
  assertServerOnly()
  const secretKey = requireEnv('XENDIT_SECRET_KEY_READ')

  const res = await fetch(`${XENDIT_API_BASE}/sessions/${sessionId}`, {
    headers: { Authorization: basicAuthHeader(secretKey) },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(
      `Xendit payment session lookup failed (${res.status}): ${body}`,
    )
  }

  return res.json()
}

/** Which channel paid a session (GCASH, CARDS, ...) — the session itself
 *  and its webhook don't say. Best-effort: null on any failure, since the
 *  payment is already confirmed and this only labels it. Apple Pay is
 *  processed through Cards, so it reports as a card payment. */
export async function getXenditPaymentChannel(
  paymentId: string,
): Promise<string | null> {
  assertServerOnly()
  try {
    const secretKey = requireEnv('XENDIT_SECRET_KEY_READ')
    const res = await fetch(`${XENDIT_API_BASE}/v3/payments/${paymentId}`, {
      headers: {
        Authorization: basicAuthHeader(secretKey),
        'api-version': '2024-11-11',
      },
    })
    if (!res.ok) return null
    const body = (await res.json()) as { channel_code?: unknown }
    return typeof body.channel_code === 'string' ? body.channel_code : null
  } catch {
    return null
  }
}

/** Creates the hosted payment page for a PHP payment with whichever system
 *  XENDIT_CHECKOUT_MODE selects. `id` is what to store in the
 *  `xendit_invoice_id` column; `url` is where to send the customer. */
export async function createXenditHostedPayment(input: {
  referenceId: string
  /** Major units of PHP. */
  amount: number
  payerEmail: string
  description: string
  successUrl: string
  failureUrl: string
  /** Invoices honour this exactly; sessions are raised to Xendit's
   *  10-minute minimum. */
  lifetimeSeconds: number
}): Promise<{ id: string; url: string }> {
  if (xenditCheckoutMode() === 'sessions') {
    const session = await createXenditPaymentSession({
      referenceId: input.referenceId,
      amount: input.amount,
      description: input.description,
      successReturnUrl: input.successUrl,
      cancelReturnUrl: input.failureUrl,
      expiresInSeconds: input.lifetimeSeconds,
    })
    return { id: session.payment_session_id, url: session.payment_link_url }
  }
  const invoice = await createXenditInvoice({
    externalId: input.referenceId,
    amount: input.amount,
    currency: 'PHP',
    payerEmail: input.payerEmail,
    description: input.description,
    successRedirectUrl: input.successUrl,
    failureRedirectUrl: input.failureUrl,
    invoiceDuration: input.lifetimeSeconds,
  })
  return { id: invoice.id, url: invoice.invoice_url }
}

export interface XenditPaymentStatus {
  /** The invoice or session id that was checked. */
  id: string
  /** Money has been taken (invoice PAID/SETTLED, session COMPLETED). */
  paid: boolean
  /** Major units. */
  amount: number
  currency: string
  /** Sessions only — for getXenditPaymentChannel. */
  paymentId: string | null
}

/** Live status of an invoice or a payment session, whichever `id` is. */
export async function getXenditPaymentStatus(
  id: string,
): Promise<XenditPaymentStatus> {
  if (isXenditSessionId(id)) {
    const session = await getXenditPaymentSession(id)
    return {
      id: session.payment_session_id,
      paid: session.status === 'COMPLETED',
      amount: session.amount,
      currency: session.currency,
      paymentId: session.payment_id ?? null,
    }
  }
  const invoice = await getXenditInvoice(id)
  return {
    id: invoice.id,
    // SETTLED, not just PAID — an invoice can already have moved past PAID
    // (funds cleared) by the time it's re-checked.
    paid: invoice.status === 'PAID' || invoice.status === 'SETTLED',
    amount: invoice.amount,
    currency: invoice.currency,
    paymentId: null,
  }
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

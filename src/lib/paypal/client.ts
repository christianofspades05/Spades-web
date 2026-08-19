/**
 * Server-only PayPal API client (Orders API v2) — used for non-Philippines
 * online checkouts, since PayPal genuinely settles in the customer's real
 * currency (unlike Xendit's legacy Invoice API, which only has PHP enabled
 * — see server/checkout/place-order.ts for the country-based routing
 * between the two).
 *
 * Unlike Xendit's single fixed API key, PayPal's Sandbox and Live
 * environments are entirely separate hostnames — PAYPAL_ENVIRONMENT picks
 * which one every call in this module hits. Defaults to 'sandbox' (the
 * safe direction to default to) unless explicitly set to 'live'.
 *
 * Never import this from a route component or anything that could end up
 * in the browser bundle — same reasoning/guard as lib/xendit/client.ts.
 */
function assertServerOnly() {
  if (typeof window !== 'undefined') {
    throw new Error(
      'lib/paypal/client.ts was called from a browser context. PayPal secrets must never run client-side.',
    )
  }
}

const PAYPAL_API_BASE =
  process.env.PAYPAL_ENVIRONMENT === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing ${name}. Check your .env file against .env.example.`,
    )
  }
  return value
}

// PayPal's client-credentials access token lasts far longer than this (PayPal
// commonly issues ~9h tokens), but caching for a fixed, conservative window
// rather than parsing/trusting `expires_in` keeps this simple and never
// risks handing out a token close to its real expiry.
const ACCESS_TOKEN_CACHE_TTL_MS = 25 * 60_000
let cachedAccessToken: { token: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.token
  }

  const clientId = requireEnv('PAYPAL_CLIENT_ID')
  const clientSecret = requireEnv('PAYPAL_CLIENT_SECRET')
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    'base64',
  )

  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`PayPal OAuth token request failed (${res.status}): ${body}`)
  }
  const data = (await res.json()) as { access_token: string }
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + ACCESS_TOKEN_CACHE_TTL_MS,
  }
  return data.access_token
}

async function paypalFetch(
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<Response> {
  const accessToken = await getAccessToken()
  const { idempotencyKey, ...rest } = init
  return fetch(`${PAYPAL_API_BASE}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'PayPal-Request-Id': idempotencyKey } : {}),
      ...rest.headers,
    },
  })
}

export interface CreatePayPalOrderInput {
  /** checkout_reservations.id — carried through as PayPal's reference_id so
   *  the return route and webhook can both trace a capture back to it. */
  referenceId: string
  /** Major units (not minor/cents) — e.g. "40.69" for SGD 40.69. PayPal
   *  wants this as a decimal string, not a number. */
  amount: string
  /** ISO 4217 currency code — the real currency the customer is charged,
   *  unlike Xendit's PHP-only constraint. */
  currencyCode: string
  description: string
  returnUrl: string
  cancelUrl: string
  brandName: string
}

export interface CreatePayPalOrderResult {
  id: string
  /** The URL to redirect the customer to so they can approve payment —
   *  pulled from the response's `links` array (rel: "approve"). */
  approveUrl: string
}

export async function createPayPalOrder(
  input: CreatePayPalOrderInput,
): Promise<CreatePayPalOrderResult> {
  assertServerOnly()

  const res = await paypalFetch('/v2/checkout/orders', {
    method: 'POST',
    idempotencyKey: input.referenceId,
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: input.referenceId,
          description: input.description,
          amount: { currency_code: input.currencyCode, value: input.amount },
        },
      ],
      application_context: {
        brand_name: input.brandName,
        // We already collect and validate the shipping address ourselves
        // earlier in checkout — asking PayPal to collect one too would be
        // redundant and could disagree with what we already have.
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`PayPal order creation failed (${res.status}): ${body}`)
  }

  const data = (await res.json()) as {
    id: string
    links: { rel: string; href: string }[]
  }
  const approveUrl = data.links.find((link) => link.rel === 'approve')?.href
  if (!approveUrl) {
    throw new Error(
      `PayPal order ${data.id} response had no "approve" link — cannot redirect customer to pay.`,
    )
  }
  return { id: data.id, approveUrl }
}

export interface CapturePayPalOrderResult {
  status: string
  captureId: string
  currencyCode: string
  /** Major units, as a decimal string — e.g. "40.69". */
  amount: string
  payerEmail: string | null
}

/**
 * Finalizes the charge after the customer approves on PayPal's page and is
 * redirected back to us — PayPal's Orders API requires this explicit
 * capture call; approval alone doesn't move money. Called from the return
 * route synchronously (the primary confirmation path) and, redundantly but
 * safely, from the webhook handler as a fallback — PayPal itself no-ops a
 * capture retry on an already-captured order rather than double-charging,
 * and callers here are expected to also guard on the order already having
 * been minted (see server/checkout/mint-order.ts's own idempotency).
 */
export async function capturePayPalOrder(
  orderId: string,
): Promise<CapturePayPalOrderResult> {
  assertServerOnly()

  const res = await paypalFetch(`/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    idempotencyKey: `capture-${orderId}`,
    body: '{}',
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`PayPal order capture failed (${res.status}): ${body}`)
  }

  const data = (await res.json()) as {
    status: string
    payer?: { email_address?: string }
    purchase_units: {
      payments: {
        captures: {
          id: string
          status: string
          amount: { currency_code: string; value: string }
        }[]
      }
    }[]
  }
  const capture = data.purchase_units.at(0)?.payments.captures.at(0)
  if (!capture) {
    throw new Error(
      `PayPal order ${orderId} capture response had no capture record.`,
    )
  }
  return {
    status: capture.status,
    captureId: capture.id,
    currencyCode: capture.amount.currency_code,
    amount: capture.amount.value,
    payerEmail: data.payer?.email_address ?? null,
  }
}

/**
 * Verifies a webhook event actually came from PayPal — the same
 * never-trust-an-unverified-webhook principle as Xendit's callback-token
 * check, but PayPal's mechanism is a signature (not a static shared
 * secret): every header PayPal sent gets bundled with our configured
 * PAYPAL_WEBHOOK_ID and posted back to PayPal's own verification endpoint,
 * which checks the signature against the certificate it itself issued.
 */
export async function verifyPayPalWebhookSignature(
  headers: {
    transmissionId: string | null
    transmissionTime: string | null
    transmissionSig: string | null
    certUrl: string | null
    authAlgo: string | null
  },
  webhookEvent: unknown,
): Promise<boolean> {
  assertServerOnly()

  if (
    !headers.transmissionId ||
    !headers.transmissionTime ||
    !headers.transmissionSig ||
    !headers.certUrl ||
    !headers.authAlgo
  ) {
    return false
  }

  const webhookId = requireEnv('PAYPAL_WEBHOOK_ID')

  const res = await paypalFetch('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: JSON.stringify({
      auth_algo: headers.authAlgo,
      cert_url: headers.certUrl,
      transmission_id: headers.transmissionId,
      transmission_sig: headers.transmissionSig,
      transmission_time: headers.transmissionTime,
      webhook_id: webhookId,
      webhook_event: webhookEvent,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(
      `PayPal webhook signature verification request failed (${res.status}): ${body}`,
    )
  }

  const data = (await res.json()) as { verification_status: string }
  return data.verification_status === 'SUCCESS'
}

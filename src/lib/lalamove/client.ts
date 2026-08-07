/**
 * Server-only Lalamove API v3 client (same-day courier — see
 * src/routes/checkout/index.tsx for the customer-facing quote and
 * src/server/admin/orders.ts's bookLalamoveShipment for the actual booking).
 *
 * Never import this from a route component or anything that could end up in
 * the browser bundle — same self-guarding convention as lib/xendit/client.ts.
 *
 * IMPORTANT — verify against sandbox before relying on this in production:
 * the request signing and payload shapes below follow Lalamove's publicly
 * documented v3 API conventions (HMAC-SHA256 over
 * `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${body}`, keyed by the API
 * secret) but this hasn't been exercised against a live sandbox call yet.
 * The first real quotation request will either work or come back with a
 * `401`/`400` body describing what's wrong — check Lalamove's API reference
 * and adjust `sign()`/the payload shapes below accordingly. `MOTORCYCLE` is
 * assumed available as a serviceType for the Metro Manila pickup point; if
 * not, `GET /v3/cities` (with the `Market` header) lists what's actually
 * offered there.
 */
import { createHmac, randomUUID } from 'node:crypto'

function assertServerOnly() {
  if (typeof window !== 'undefined') {
    throw new Error(
      'lib/lalamove/client.ts was called from a browser context. Lalamove secrets must never run client-side.',
    )
  }
}

const BASE_URLS = {
  sandbox: 'https://rest.sandbox.lalamove.com',
  production: 'https://rest.lalamove.com',
} as const

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing ${name}. Check your .env file against .env.example.`,
    )
  }
  return value
}

function getBaseUrl(): string {
  return process.env.LALAMOVE_ENV === 'production'
    ? BASE_URLS.production
    : BASE_URLS.sandbox
}

function getMarket(): string {
  return process.env.LALAMOVE_MARKET ?? 'PH'
}

function getPickupStop(): { coordinates: { lat: string; lng: string }; address: string } {
  return {
    coordinates: {
      lat: requireEnv('LALAMOVE_PICKUP_LAT'),
      lng: requireEnv('LALAMOVE_PICKUP_LNG'),
    },
    address: requireEnv('LALAMOVE_PICKUP_ADDRESS'),
  }
}

/** Lowercase hex HMAC-SHA256 of the exact request line Lalamove expects — see module doc comment. */
function sign(method: string, path: string, timestamp: number, body: string): string {
  const secret = requireEnv('LALAMOVE_API_SECRET')
  const raw = `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${body}`
  return createHmac('sha256', secret).update(raw).digest('hex')
}

async function lalamoveRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  assertServerOnly()
  const apiKey = requireEnv('LALAMOVE_API_KEY')
  const timestamp = Date.now()
  const bodyString = body !== undefined ? JSON.stringify(body) : ''
  const signature = sign(method, path, timestamp, bodyString)

  const res = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `hmac ${apiKey}:${timestamp}:${signature}`,
      Market: getMarket(),
      'Request-ID': randomUUID(),
      'Content-Type': 'application/json',
    },
    ...(bodyString ? { body: bodyString } : {}),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Lalamove ${method} ${path} failed (${res.status}): ${text}`)
  }
  const json = (await res.json()) as { data: T }
  return json.data
}

export interface LalamoveQuotation {
  quotationId: string
  pickupStopId: string
  dropoffStopId: string
  feeCents: number
  currency: string
  expiresAt: string
}

/** Fetches a fresh quotation — never cache/reuse one across requests, it's
 *  only valid for 5 minutes from Lalamove's side. */
export async function getLalamoveQuotation(input: {
  dropoffLat: number
  dropoffLng: number
  dropoffAddress: string
}): Promise<LalamoveQuotation> {
  const data = await lalamoveRequest<{
    quotationId: string
    expiresAt: string
    stops: { stopId: string }[]
    priceBreakdown: { total: string; currency: string }
  }>('POST', '/v3/quotations', {
    data: {
      serviceType: 'MOTORCYCLE',
      language: 'en_PH',
      stops: [
        getPickupStop(),
        {
          coordinates: {
            lat: String(input.dropoffLat),
            lng: String(input.dropoffLng),
          },
          address: input.dropoffAddress,
        },
      ],
    },
  })

  if (data.stops.length < 2) {
    throw new Error('Lalamove quotation response is missing stop IDs')
  }
  const [pickup, dropoff] = data.stops

  return {
    quotationId: data.quotationId,
    pickupStopId: pickup.stopId,
    dropoffStopId: dropoff.stopId,
    feeCents: Math.round(parseFloat(data.priceBreakdown.total) * 100),
    currency: data.priceBreakdown.currency,
    expiresAt: data.expiresAt,
  }
}

export interface LalamoveBooking {
  lalamoveOrderId: string
  status: string
  shareLink: string
  feeCents: number
  raw: unknown
}

export async function placeLalamoveOrder(input: {
  quotationId: string
  pickupStopId: string
  dropoffStopId: string
  senderName: string
  senderPhone: string
  recipientName: string
  recipientPhone: string
  remarks?: string
}): Promise<LalamoveBooking> {
  const data = await lalamoveRequest<{
    orderId: string
    status: string
    shareLink: string
    priceBreakdown: { total: string }
  }>('POST', '/v3/orders', {
    data: {
      quotationId: input.quotationId,
      sender: {
        stopId: input.pickupStopId,
        name: input.senderName,
        phone: input.senderPhone,
      },
      recipients: [
        {
          stopId: input.dropoffStopId,
          name: input.recipientName,
          phone: input.recipientPhone,
          ...(input.remarks ? { remarks: input.remarks } : {}),
        },
      ],
    },
  })

  return {
    lalamoveOrderId: data.orderId,
    status: data.status,
    shareLink: data.shareLink,
    feeCents: Math.round(parseFloat(data.priceBreakdown.total) * 100),
    raw: data,
  }
}

/** Lalamove's own order status enum: ASSIGNING_DRIVER | ON_GOING |
 *  PICKED_UP | COMPLETED | CANCELED | REJECTED | EXPIRED. Powers the admin
 *  "Refresh status" action — there's no incoming webhook wired up yet. */
export async function getLalamoveOrderStatus(
  lalamoveOrderId: string,
): Promise<{ status: string; raw: unknown }> {
  const data = await lalamoveRequest<{ status: string }>(
    'GET',
    `/v3/orders/${lalamoveOrderId}`,
  )
  return { status: data.status, raw: data }
}

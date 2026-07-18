/**
 * Raw HTTP client for Shopee's Open Platform API (v2). Isolates every
 * Shopee-specific wire detail (base URLs, request signing, token endpoints)
 * so nothing outside this file needs to know how Shopee's API actually
 * works — adapter.ts is the only thing that imports this.
 *
 * IMPORTANT — verify before relying on this in production: the request
 * signing below (`sign()`) follows Shopee Open Platform v2's publicly
 * documented conventions (HMAC-SHA256, keyed by the partner key, over
 * `partner_id + api_path + timestamp` for public/auth endpoints, or
 * `partner_id + api_path + timestamp + access_token + shop_id` for
 * shop-level endpoints), but hasn't been exercised against a live or
 * sandbox shop. The very first call (e.g. clicking "Connect" on the admin
 * Channels page) will either work or come back with an `error` field in the
 * response body — if the latter, check Shopee Open Platform → API docs →
 * "Authorization" and "Signature" pages and adjust `sign()` and
 * `callShopeeApi()` accordingly. Same caveat for the exact product/order
 * endpoint paths and payload shapes in adapter.ts.
 *
 * SHOPEE_ENV picks the base URL — every new app starts in Sandbox until
 * Shopee approves Live access for it (see .env.example).
 */
import { createHmac } from 'node:crypto'

const BASE_URLS = {
  sandbox: 'https://partner.test-stable.shopeemobile.com',
  live: 'https://partner.shopeemobile.com',
} as const

function assertServerOnly() {
  if (typeof window !== 'undefined') {
    throw new Error(
      'integrations/marketplaces/shopee/client.ts was called from a browser context. Shopee app secrets must never run client-side.',
    )
  }
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

function getPartnerId(): string {
  return requireEnv('SHOPEE_PARTNER_ID')
}

function getPartnerKey(): string {
  return requireEnv('SHOPEE_PARTNER_KEY')
}

function getBaseUrl(): string {
  const env = process.env.SHOPEE_ENV === 'live' ? 'live' : 'sandbox'
  return BASE_URLS[env]
}

function getSiteUrl(): string {
  return requireEnv('SITE_URL')
}

/** Shopee's HMAC-SHA256 signature, keyed by the partner key. `extra` is `access_token + shop_id` for shop-level calls, or omitted for public/auth calls. */
function sign(path: string, timestamp: number, extra = ''): string {
  const partnerId = getPartnerId()
  const baseString = `${partnerId}${path}${timestamp}${extra}`
  return createHmac('sha256', getPartnerKey())
    .update(baseString)
    .digest('hex')
}

/**
 * The URL to send staff to in order to authorize this app on their Shopee
 * shop. Shopee redirects back to `redirect` with `?code=...&shop_id=...`
 * once the seller approves.
 */
export function buildAuthorizationUrl(state: string): string {
  assertServerOnly()
  const path = '/api/v2/shop/auth_partner'
  const timestamp = Math.floor(Date.now() / 1000)
  const url = new URL(`${getBaseUrl()}${path}`)
  url.searchParams.set('partner_id', getPartnerId())
  url.searchParams.set('timestamp', timestamp.toString())
  url.searchParams.set('sign', sign(path, timestamp))
  url.searchParams.set(
    'redirect',
    `${getSiteUrl()}/api/oauth/shopee/callback?state=${encodeURIComponent(state)}`,
  )
  return url.toString()
}

export interface ShopeeTokenResponse {
  access_token: string
  refresh_token: string
  expire_in: number
  shop_id?: number
  error?: string
  message?: string
}

async function requestToken(
  path: string,
  body: Record<string, unknown>,
): Promise<ShopeeTokenResponse> {
  assertServerOnly()
  const timestamp = Math.floor(Date.now() / 1000)
  const url = new URL(`${getBaseUrl()}${path}`)
  url.searchParams.set('partner_id', getPartnerId())
  url.searchParams.set('timestamp', timestamp.toString())
  url.searchParams.set('sign', sign(path, timestamp))

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ partner_id: Number(getPartnerId()), ...body }),
  })
  const responseBody = (await res.json()) as ShopeeTokenResponse
  if (!res.ok || responseBody.error) {
    throw new Error(`Shopee token request failed: ${JSON.stringify(responseBody)}`)
  }
  return responseBody
}

export async function exchangeAuthCode(
  code: string,
  shopId: string,
): Promise<ShopeeTokenResponse> {
  return requestToken('/api/v2/auth/token/get', {
    code,
    shop_id: Number(shopId),
  })
}

export async function refreshAccessToken(
  refreshToken: string,
  shopId: string,
): Promise<ShopeeTokenResponse> {
  return requestToken('/api/v2/auth/access_token/get', {
    refresh_token: refreshToken,
    shop_id: Number(shopId),
  })
}

export interface SignedRequestOptions {
  method: 'GET' | 'POST'
  path: string
  accessToken: string
  shopId: string
  query?: Record<string, string>
  body?: Record<string, unknown>
}

export async function callShopeeApi<T>(
  options: SignedRequestOptions,
): Promise<T> {
  assertServerOnly()
  const timestamp = Math.floor(Date.now() / 1000)
  const extra = `${options.accessToken}${options.shopId}`

  const url = new URL(`${getBaseUrl()}${options.path}`)
  url.searchParams.set('partner_id', getPartnerId())
  url.searchParams.set('timestamp', timestamp.toString())
  url.searchParams.set('sign', sign(options.path, timestamp, extra))
  url.searchParams.set('access_token', options.accessToken)
  url.searchParams.set('shop_id', options.shopId)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value)
  }

  const res = await fetch(url.toString(), {
    method: options.method,
    headers: { 'content-type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const responseBody = await res.json()
  if (!res.ok || responseBody.error) {
    throw new Error(
      `Shopee API call failed (${options.path}): ${JSON.stringify(responseBody)}`,
    )
  }
  return responseBody.response as T
}

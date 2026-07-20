/**
 * Raw HTTP client for TikTok Shop's Partner Center Open API (v2). Isolates
 * every TikTok-specific wire detail (base URLs, request signing, token
 * endpoints) so nothing outside this file needs to know how TikTok's API
 * actually works — adapter.ts is the only thing that imports this.
 *
 * IMPORTANT — verify before relying on this in production: the request
 * signing below (`sign()`) is implemented from TikTok's publicly documented
 * conventions (HMAC-SHA256 over the app secret + path + sorted query params
 * + body), but Partner Center's own API reference is a JS-rendered app that
 * couldn't be fetched while building this. The very first live call will
 * either work or come back with a clear "signature mismatch" error — if the
 * latter, check Partner Center → API docs → "How to call TikTok Shop Open
 * API" and adjust `sign()` and `callTikTokApi()` accordingly. Same caveat
 * for the exact inventory/order endpoint paths and payload shapes in
 * adapter.ts, which are TikTok's documented 202309 API version conventions
 * but haven't been exercised against a live shop.
 */
import { createHmac } from 'node:crypto'

const AUTH_BASE = 'https://auth.tiktok-shops.com'
const API_BASE = 'https://open-api.tiktokglobalshop.com'

function assertServerOnly() {
  if (typeof window !== 'undefined') {
    throw new Error(
      'integrations/marketplaces/tiktok-shop/client.ts was called from a browser context. TikTok app secrets must never run client-side.',
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
  // TEMPORARY debug logging — remove once the TikTok "invalid sign" 401 is
  // diagnosed. Logs length/edges only, never the full secret.
  console.error('[tiktok-env-debug]', name, {
    len: value.length,
    edges: `${value.slice(0, 4)}...${value.slice(-4)}`,
  })
  return value
}

function getAppKey(): string {
  return requireEnv('TIKTOK_SHOP_APP_KEY')
}

function getAppSecret(): string {
  return requireEnv('TIKTOK_SHOP_APP_SECRET')
}

export interface TikTokTokenResponse {
  access_token: string
  access_token_expire_in: number
  refresh_token: string
  refresh_token_expire_in: number
  open_id?: string
  seller_name?: string
}

export function buildAuthorizationUrl(state: string): string {
  assertServerOnly()
  const url = new URL(`${AUTH_BASE}/oauth/authorize`)
  url.searchParams.set('app_key', getAppKey())
  url.searchParams.set('state', state)
  return url.toString()
}

async function requestToken(
  params: Record<string, string>,
): Promise<TikTokTokenResponse> {
  const url = new URL(`${AUTH_BASE}/api/v2/token/get`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  const res = await fetch(url.toString())
  const body = await res.json()
  if (!res.ok || body.code !== 0) {
    throw new Error(`TikTok token request failed: ${JSON.stringify(body)}`)
  }
  return body.data
}

export async function exchangeAuthCode(
  code: string,
): Promise<TikTokTokenResponse> {
  assertServerOnly()
  return requestToken({
    app_key: getAppKey(),
    app_secret: getAppSecret(),
    auth_code: code,
    grant_type: 'authorized_code',
  })
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<TikTokTokenResponse> {
  assertServerOnly()
  return requestToken({
    app_key: getAppKey(),
    app_secret: getAppSecret(),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
}

/**
 * TikTok's request signature: HMAC-SHA256, keyed by the app secret, over
 * `app_secret + path + <sorted query params, each as key+value, "sign" and
 * "access_token" excluded> + <raw JSON body, if any> + app_secret`.
 */
function sign(
  path: string,
  params: Record<string, string>,
  body: string,
): string {
  const appSecret = getAppSecret()
  const sortedKeys = Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'access_token')
    .sort()
  const paramString = sortedKeys.map((k) => `${k}${params[k]}`).join('')
  const stringToSign = `${appSecret}${path}${paramString}${body}${appSecret}`
  return createHmac('sha256', appSecret).update(stringToSign).digest('hex')
}

export interface SignedRequestOptions {
  method: 'GET' | 'POST'
  path: string
  accessToken: string
  shopCipher?: string
  query?: Record<string, string>
  body?: Record<string, unknown>
}

export async function callTikTokApi<T>(
  options: SignedRequestOptions,
): Promise<T> {
  assertServerOnly()
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const bodyString = options.body ? JSON.stringify(options.body) : ''

  const query: Record<string, string> = {
    app_key: getAppKey(),
    timestamp,
    ...(options.shopCipher ? { shop_cipher: options.shopCipher } : {}),
    ...(options.query ?? {}),
  }
  query.sign = sign(options.path, query, bodyString)

  const url = new URL(`${API_BASE}${options.path}`)
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }

  const res = await fetch(url.toString(), {
    method: options.method,
    headers: {
      'content-type': 'application/json',
      'x-tts-access-token': options.accessToken,
    },
    body: options.body ? bodyString : undefined,
  })

  const responseBody = await res.json()
  if (!res.ok || responseBody.code !== 0) {
    throw new Error(
      `TikTok API call failed (${options.path}): ${JSON.stringify(responseBody)}`,
    )
  }
  return responseBody.data as T
}

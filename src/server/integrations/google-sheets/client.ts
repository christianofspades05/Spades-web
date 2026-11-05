/**
 * Minimal Google Sheets v4 client authenticated as a service account — no
 * `googleapis` dependency, just a hand-rolled JWT-bearer OAuth2 flow (Node's
 * built-in `crypto` can RS256-sign the assertion directly) and the raw REST
 * API, mirroring how windsor/client.ts talks to its own API with plain
 * fetch. Used only by api/cron/sync-gross-profit-to-sheet.ts. Service
 * account must be shared as an Editor on any spreadsheet this writes to —
 * it has no access of its own otherwise.
 */
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

interface ServiceAccountCreds {
  email: string
  privateKey: string
}

function getServiceAccountCreds(): ServiceAccountCreds {
  const email = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL
  // Env vars can't hold real newlines, so the key is stored with literal
  // "\n" escape sequences and unescaped here — the standard way a PEM key
  // survives a single-line env var.
  const privateKey =
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!email || !privateKey) {
    throw new Error(
      'Missing GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL or GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY.',
    )
  }
  return { email, privateKey }
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null

/** Short-lived (1h) access tokens, cached in-memory for the lifetime of
 *  this serverless function instance — cheap insurance against calling the
 *  token endpoint on every single cron run that happens to reuse a warm
 *  instance. Refetched with a minute of slack before the real expiry. */
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken
  }

  const { email, privateKey } = getServiceAccountCreds()
  const nowSeconds = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: email,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`

  const { createSign } = await import('node:crypto')
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  signer.end()
  const signature = base64url(signer.sign(privateKey))
  const jwt = `${unsigned}.${signature}`

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  const body = (await response.json()) as {
    access_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }
  if (!response.ok || !body.access_token) {
    throw new Error(
      `Google token exchange failed: ${body.error ?? response.status} ${body.error_description ?? ''}`,
    )
  }
  cachedToken = {
    accessToken: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  }
  return cachedToken.accessToken
}

/**
 * Writes a single value into one cell (or any A1 range — `values[0][0]` is
 * all that's used today, but the shape allows a wider range later).
 * `USER_ENTERED` so a plain number lands as a number the sheet's existing
 * currency formatting on that cell renders correctly, same as typing it by
 * hand — matches `RAW` only for literal text.
 */
export async function updateSheetValue(
  spreadsheetId: string,
  a1Range: string,
  value: string | number,
): Promise<void> {
  const accessToken = await getAccessToken()
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(a1Range)}?valueInputOption=USER_ENTERED`
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [[value]] }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Sheets API write failed: ${response.status} ${body}`)
  }
}

/** Same as updateSheetValue, but writes several single-cell values in one
 *  request (Sheets' values:batchUpdate) instead of one round trip per
 *  cell — used by api/cron/sync-gross-profit-to-sheet.ts, which writes
 *  three unrelated cells on every run. */
export async function updateSheetValues(
  spreadsheetId: string,
  entries: Array<{ a1Range: string; value: string | number }>,
): Promise<void> {
  if (entries.length === 0) return
  const accessToken = await getAccessToken()
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data: entries.map((entry) => ({
        range: entry.a1Range,
        values: [[entry.value]],
      })),
    }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Sheets API batch write failed: ${response.status} ${body}`)
  }
}

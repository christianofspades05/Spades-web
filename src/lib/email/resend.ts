/**
 * Server-only Resend API client, called via plain fetch (same approach as
 * lib/xendit/client.ts) rather than adding the `resend` package as a
 * dependency.
 *
 * Never import this from a route component or anything that could end up in
 * the browser bundle. The guard fires at call time (not module top-level) —
 * a throw-on-import would crash the whole page's hydration if this module
 * ever ends up merely *imported* into a client bundle by accident, even
 * without sendEmail ever being called.
 */
const RESEND_API_BASE = 'https://api.resend.com'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing ${name}. Check your .env file against .env.example.`,
    )
  }
  return value
}

/**
 * Wraps a from-address env var with a friendly display name for Resend's
 * `from` field ("Name <email>") — inboxes show the name instead of the
 * bare address. Passes an unset env var straight through as `undefined` so
 * sendEmail()'s own RESEND_FROM_EMAIL fallback (and its "Missing X" error)
 * still kick in normally.
 */
export function withDisplayName(
  name: string,
  email: string | undefined,
): string | undefined {
  return email ? `${name} <${email}>` : email
}

export interface SendEmailInput {
  to: string
  subject: string
  html: string
  /** Overrides RESEND_FROM_EMAIL for this one send — each automation cron
   *  resolves its own optional category-specific env var (e.g.
   *  RESEND_FROM_EMAIL_ABANDONED_CART) and passes it here, falling back to
   *  undefined (this function's own RESEND_FROM_EMAIL default) when that
   *  category has no override configured. */
  from?: string
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  if (typeof window !== 'undefined') {
    throw new Error(
      'sendEmail() was called from a browser context. The Resend API key must never run client-side.',
    )
  }

  const apiKey = requireEnv('RESEND_API_KEY')
  const from = input.from ?? requireEnv('RESEND_FROM_EMAIL')

  const res = await fetch(`${RESEND_API_BASE}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Resend send failed (${res.status}): ${body}`)
  }
}
